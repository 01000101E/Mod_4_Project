const router = require("express").Router();
const { Op } = require("sequelize");
const {
  Spot,
  SpotImages,
  User,
  Review,
  Sequelize,
  ReviewImages,
  Booking,
} = require("../../db/models");
const bookingsRouter = require("./bookings");
const reviewsRouter = require("./reviews");
const { requireAuth } = require("../../utils/auth.js");
const { check } = require("express-validator");
const { handleValidationErrors } = require("../../utils/validation");

// validate spot body
const validateSpot = [
  check("address")
    .exists({ checkFalsy: true })
    .withMessage("Street address is required"),
  check("city").exists({ checkFalsy: true }).withMessage("City is required"),
  check("state").exists({ checkFalsy: true }).withMessage("State is required"),
  check("country")
    .exists({ checkFalsy: true })
    .withMessage("Country is required"),
  check("lat")
    .exists({ checkFalsy: true })
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude is not valid"),
  check("lng")
    .exists({ checkFalsy: true })
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude is not valid"),
  check("name").exists({ checkFalsy: true }).withMessage("Name is required"),
  check("description")
    .exists({ checkFalsy: true })
    .withMessage("Description is required"),
  check("price")
    .exists({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage("Price per day is required"),
  handleValidationErrors,
];

// check validation for reviews
const validateReview = [
  check("review")
    .exists({ checkFalsy: true })
    .withMessage("Review text is required"),
  check("stars")
    .exists({ checkFalsy: true })
    .isInt({ min: 1, max: 5 })
    .withMessage("Stars must be an integer from 1 to 5"),
  handleValidationErrors,
];

const validateBooking = [
  // Check if startDate exists
  check("startDate")
    .exists({ checkFalsy: true })
    .withMessage("Start date is required"),

  // Check if endDate exists
  check("endDate")
    .exists({ checkFalsy: true })
    .withMessage("End date is required"),

  // Custom validation to check if startDate is before endDate
  check("startDate").custom((value, { req }) => {
    const startDate = new Date(value);
    const endDate = new Date(req.body.endDate);

    if (startDate >= endDate) {
      throw new Error("Start date must be before end date");
    }

    // If the validation passes, return true
    return true;
  }),
  handleValidationErrors,
];

// CRUD Routes to manage Spots, SpotImages, Reviews, Bookings

router.use("/:spotId/bookings", bookingsRouter);
router.use("/:spotId/reviews", reviewsRouter);

// Get all Spots
// /api/spots
router.get("/", async (req, res, next) => {
  let { page, size, minLat, maxLat, minLng, maxLng, minPrice, maxPrice } =
    req.query;

  // convert page and size to integers from strings
  page = parseInt(page, 10) || 1;
  size = parseInt(size, 10) || 20;

  const pagination = {
    limit: size,
    offset: (page - 1) * size,
  };

  // convert any other filter conditions
  const filterConditions = {};

  if (minLat || maxLat) {
    filterConditions.lat = {};
    if (minLat) filterConditions.lat[Op.gte] = parseFloat(minLat);
    if (maxLat) filterConditions.lat[Op.lte] = parseFloat(maxLat);
  }

  if (minLng || maxLng) {
    filterConditions.lng = {};
    if (minLng) filterConditions.lng[Op.gte] = parseFloat(minLng);
    if (maxLng) filterConditions.lng[Op.lte] = parseFloat(maxLng);
  }

  if (minPrice || maxPrice) {
    filterConditions.price = {};
    if (minPrice) filterConditions.price[Op.gte] = parseFloat(minPrice);
    if (maxPrice) filterConditions.price[Op.lte] = parseFloat(maxPrice);
  }

  try {
    const spots = await Spot.findAll({
      where: filterConditions,
      ...pagination,
    });

    // get average rating for each spot
    const spotIds = spots.map((spot) => spot.id);
    const avgRatings = await Review.findAll({
      where: {
        spotId: {
          [Op.in]: spotIds,
        },
      },
      attributes: [
        "spotId",
        [Sequelize.fn("AVG", Sequelize.col("stars")), "avgRating"],
      ],
      group: ["spotId"],
    });

    const avgRatingsMap = avgRatings.reduce((acc, { spotId, avgRating }) => {
      acc[spotId] = parseFloat(avgRating);
      return acc;
    }, {});

    const spotsResults = spots.map((spot) => ({
      ...spot.toJSON(),
      avgRating: avgRatingsMap[spot.id] || null,
    }));

    const spotsResponse = {
      Spots: spotsResults,
      page: parseInt(page, 10),
      size: parseInt(size, 10),
      total: spots.length,
    };
    res.json(spotsResponse);
  } catch (error) {
    next(error);
  }
});

// get all spots owned by the current user
// /api/spots/current ~ not /spots/:ownerId
router.get("/current", requireAuth, async (req, res, next) => {
  // get current user from restoreUser middleware
  //(already implemented on all routes)
  const uid = req.user.id;

  try {
    const currentUserSpots = await Spot.findAll({
      where: { ownerId: uid },
    });

    res.json(currentUserSpots);
  } catch (error) {
    next(error);
  }
});

// get details of a Spot from an id
router.get("/:spotId", async (req, res, next) => {
  const spotId = req.params.spotId;
  let avgStarRating;
  const numReviews = await Review.count({
    where: { spotId },
  });

  const reviews = await Review.findAll({
    where: { spotId },
    attributes: ["stars"],
  });

  if (reviews.length > 0) {
    const totalStars = reviews.reduce((acc, review) => acc + review.stars, 0);
    avgStarRating = totalStars / numReviews;
  } else {
    // Handle case where there are no reviews
    avgStarRating = 0;
  }

  try {
    const preSpot = await Spot.findByPk(spotId, {
      attributes: [
        "id",
        "ownerId",
        "address",
        "city",
        "state",
        "country",
        "lat",
        "lng",
        "name",
        "description",
        "price",
      ],
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName"], // only has id, firstName, lastName
          as: "Owner",
        },
        {
          model: SpotImages,
          attributes: [
            "id",
            "ownerId",
            "address",
            "city",
            "state",
            "country",
            "lat",
            "lng",
            "name",
            "description",
            "price",
          ],
          as: "SpotImages",
        },
      ],
    });

    // preSpot.avgRating = avgStarRating;

    if (!preSpot) {
      //spot not found
      const err = new Error("Spot couldn't be found");
      err.status = 404;
      return next(err);
    }
    const spotResult = {
      id: preSpot.id,
      ownerId: preSpot.ownerId,
      address: preSpot.address,
      city: preSpot.city,
      state: preSpot.state,
      country: preSpot.country,
      lat: preSpot.lat,
      lng: preSpot.lng,
      name: preSpot.name,
      description: preSpot.description,
      price: preSpot.price,
      createdAt: preSpot.createdAt,
      updatedAt: preSpot.updatedAt,
      numReviews,
      avgStarRating,
      SpotImages: preSpot.SpotImages,
      Owner: preSpot.Owner,
    };

    res.json(spotResult);
  } catch (e) {
    next(e);
  }
});
// Get all reviews for a spot
// /api/spots/:spotId/reviews
router.get("/:spotId/reviews", async (req, res, next) => {
  const spotId = req.params.spotId;
  try {
    const spot = await Spot.findByPk(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot couldn't be found" });
    }

    const spotReviews = await Review.findAll({
      where: { spotId },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName"],
        },
        {
          model: ReviewImages,
          attributes: ["id", "url"],
        },
      ],
    });
    res.json(spotReviews);
  } catch (error) {
    next(error);
  }
});

// Create a spot
// /api/spots
router.post("/", requireAuth, validateSpot, async (req, res, next) => {
  // pass in ownerId from restoreUser middleware
  const ownerId = req.user.id;
  const { address, city, state, country, lat, lng, name, description, price } =
    req.body;

  // 400 Status for body errors
  // Note: we'll use express-validator to validate the request body
  // This has been handled in "../../utils/validation.js"

  try {
    const newSpot = await Spot.create({
      address,
      city,
      state,
      country,
      lat,
      lng,
      name,
      description,
      price,
      ownerId,
    });
    res.status(201).json(newSpot);
  } catch (error) {
    next(error);
  }
});

// Add image to spot based on spot id
// /api/spots/:spotId/images
// Also requires proper authorization in addition to authentication
router.post("/:spotId/images", requireAuth, async (req, res, next) => {
  const spotId = req.params.spotId;
  const { url, preview } = req.body;
  //get ownerId to make sure current user is owner of spot
  const ownerId = req.user.id;

  if (!url) {
    const err = new Error("Validation error");
    err.status = 400;
    err.message = "Validation error";
    err.errors = { url: "Image url is required" };
    return next(err);
  }

  try {
    // Check if spot exists
    const spot = await Spot.findByPk(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot couldn't be found" });
    }

    // Check if current user is owner of spot
    if (spot.ownerId !== ownerId) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    const newSpotImage = await SpotImages.create({
      url,
      preview,
      spotId,
    });

    res.status(201).json(newSpotImage);
  } catch (error) {
    next(error);
  }
});

// create a booking from a spot based on spot id
router.post(
  "/:spotId/bookings",
  requireAuth,
  validateBooking,
  async (req, res, next) => {
    const ownerId = req.user.id;
    const { startDate, endDate } = req.body;
    const spotId = req.params.spotId;
    try {
      // check if the spot exists
      const spot = await Spot.findByPk(spotId);
      if (!spot) {
        const err = new Error("Spot Image couldn't be found");
        err.status = 404;
        next(err);
      }

      // check if the user is the owner of the spot
      if (spot.ownerId === ownerId) {
        const err = new Error("Spot must not belong to user");
        err.status = 403;
        next(err);
      }

      // booking conflicts with any existing booking
      const bookingConflicts = await Booking.findAll({
        where: {
          spotId,
          [Op.or]: [
            {
              startDate: {
                [Op.between]: [startDate, endDate],
              },
            },
            {
              endDate: {
                [Op.between]: [startDate, endDate],
              },
            },
          ],
        },
      });

      if (bookingConflicts.length > 0) {
        const err = new Error(
          "Sorry, this spot is already booked for the specified dates"
        );
        err.status = 403;
        return next(err);
      }

      const booking = await Booking.create({
        spotId,
        userId: ownerId,
        startDate,
        endDate,
      });
      res.status(201).json(booking);
    } catch (e) {
      next(e);
    }
  }
);

// Create a review for a spot based on spot id
// /api/spots/:spotId/reviews
router.post(
  "/:spotId/reviews",
  requireAuth,
  validateReview,
  async (req, res, next) => {
    const spotId = req.params.spotId;
    const { review, stars } = req.body;
    // get the userId to add the review. Comes from restoreUser middleware
    const uid = req.user.id;

    // 400 Status for body errors

    try {
      // check if spot exists
      const spot = await Spot.findByPk(spotId);

      if (!spot) {
        return res.status(404).json({ message: "Spot couldn't be found" });
      }

      // user can not review their own spot
      if (spot.ownerId === uid) {
        return res
          .status(403)
          .json({ message: "Forbidden: Can not review your own spot" });
      }

      // check if review already exists
      const existingReview = await Review.findOne({
        where: { spotId, userId: uid },
      });
      if (existingReview) {
        return res
          .status(500)
          .json({ message: "User already has a review for this spot" });
      }

      const newReview = await Review.create({
        spotId,
        userId: uid,
        review,
        stars,
      });
      res.status(201).json(newReview);
    } catch (error) {
      next(error);
    }
  }
);

// Edit a spot
// /api/spots/:spotId
// Also requires proper authorization in addition to authentication
router.put("/:spotId", requireAuth, validateSpot, async (req, res, next) => {
  const spotId = req.params.spotId;
  const { address, city, state, country, lat, lng, name, description, price } =
    req.body;
  const ownerId = req.user.id;

  // 400 Status for body errors
  // Note: we'll use express-validator to validate the request body
  // This has been handled in "../../utils/validation.js"

  try {
    const spot = await Spot.findByPk(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot couldn't be found" });
    }

    if (spot.ownerId !== ownerId) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    await spot.update({
      address,
      city,
      state,
      country,
      lat,
      lng,
      name,
      description,
      price,
    });
    await spot.save();

    res.json({
      id: spot.id,
      address,
      city,
      state,
      country,
      lat,
      lng,
      name,
      description,
      price,
    });
  } catch (error) {
    next(error);
  }
});

// Delete a spot
// /api/spots/:spotId
// Also requires proper authorization in addition to authentication
router.delete("/:spotId", requireAuth, async (req, res, next) => {
  const spotId = req.params.spotId;
  const ownerId = req.user.id;

  try {
    const spot = await Spot.findByPk(spotId);
    if (!spot) {
      return res.status(404).json({ message: "Spot couldn't be found" });
    }

    if (spot.ownerId !== ownerId) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    spot.destroy();

    res.status(200).json({
      message: "Successfully deleted",
    });
  } catch (error) {
    next(error);
  }
});

// get all bookings for a spot based on spot id
router.get("/:spotId/bookings", requireAuth, async (req, res, next) => {
  const spotId = req.params.spotId;
  const uid = req.user.id;

  try {
    const spot = await Spot.findByPk(spotId);
    if (!spot) {
      const err = new Error("Spot couldn't be found");
      err.status = 404;
      return next(err);
    }
    // is the user the owner of the spot?
    const isOwner = spot.ownerId === uid;

    let bookings;

    // if the user is the owner of the spot, include all details
    if (isOwner) {
      bookings = await Booking.findAll({
        where: { spotId },
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName"], // only has id, firstName, lastName
            as: "User",
          },
        ],
      });

      return res.json({ Bookings: bookings });
    }

    // if the user is not the owner of the spot, only include basic details
    bookings = await Booking.findAll({
      where: { spotId },
      attributes: ["spotId", "startDate", "endDate"],
    });
    return res.json({ Bookings: bookings });
  } catch (error) {
    next(error);
  }
});
module.exports = router;
