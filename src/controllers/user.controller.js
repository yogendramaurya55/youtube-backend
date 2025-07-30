import { asynchandler } from "../utils/asynchandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnColudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiRespose.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(500, "Something went wrong while generating tokens");
  }
};

const registerUser = asynchandler(async (req, res) => {
  //steps to register
  //step1:  get deatils from frontend
  //step2: validation check for data fields
  //step3: check if user already exist : using email or username
  //step4: check for the images , specially avtar because it is required
  //step5: uplad them to cloudinary
  //step6: check that multer upload the image to folder or not and also check that images uploaded on cloudinary or not
  //step7: create a object - create entry in DB
  //step8: as when the object is saved it response the same data so we ave to remove password and refresh token feild from response
  //step9: check for user creation
  // return response

  const { fullName, email, username, password } = req.body;
  

  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "all feilds are required ");
  }

  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "user with email or username already exist");
  }

  const avatarLocalPath = req.files?.avatar[0]?.path;
  // const coverImageLocalPath = req.files?.coverImage[0]?.path || ""

  const coverImageLocalPath = req.files?.coverImage?.[0]?.path ?? "";

  // let coverImageLocalPath;
  // if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
  //     coverImageLocalPath = req.files.coverImage[0].path
  // }

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }

  const avatar = await uploadOnColudinary(avatarLocalPath);
  const coverImage = await uploadOnColudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar file is required");
  }

  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  });

  //cheacking if user is created in database or not if it is created then we have a automatically generated feild "_id" by mongodb
  const createdUser = await User.findById(user._id).select(
    //removing the feild for response object
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user");
  }

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered succesfully"));
});

const loginUser = asynchandler(async (req, res) => {
  //steps to login
  //step1: res.body -> data
  //steps: login with username or email so check these feilds must present in req.body
  //step3: find user in database
  //step4: check password is correct
  //step5: generate the acces and refresh token
  //step6: send cookie of access token and refreshtoken to client
  //step7: send a welcome message

  const { email, username, password } = req.body;

  if (!(username || email)) {
    throw new ApiError(400, "username or email is required ");
  }

  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "user doesn't exist");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User Logged In"
      )
    );
});

const logoutUser = asynchandler(async (req, res) => {
  //if we are logged in so while logging user we have create a user object and added it to req body so now we have the access of the req.user

  await User.findByIdAndUpdate(
    req.user._id,
    {
      $unset: {
        refreshToken: 1,
      },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asynchandler(async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;
  
  if (!incomingRefreshToken) {
    throw new ApiError(401, "unauthorized request");
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    

    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "Invalid refresh Token");
    }

    

    if (incomingRefreshToken != user?.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used ");
    }

    const options = {
      httpOnly: true,
      secure: true,
    };

    const { accessToken, newrefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newrefreshToken, options)
      .json(
        new ApiResponse(
          200,
          {
            accessToken,
            refreshToken: newrefreshToken,
          },
          "Access token is refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh Token");
  }
});

const changeCurrentPassword = asynchandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user?._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordCorrect) {
    throw new ApiError(
      400,
      "Invalid password : please enter the correct old password"
    );
  }

  user.password = newPassword;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "password changed successfully"));
});

const getCurrentUser = asynchandler(async (req, res) => {
  return res
    .status(200)
    .json(
      new ApiResponse(200, req.user, " current user data returned successfully")
    );
});

const updateAccountDetails = asynchandler(async (req, res) => {
  const { fullName, email } = req.body;

  if (!fullName || !email) {
    throw new ApiError(400, "All feilds are required ");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName,
        email,
      },
    },
    { new: true } // if true then it will return the update value of user
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

//we can update the avatar image in updateaccount details but it is always recommended and used to update files in a different api endpoint
const updateUserAvatar = asynchandler(async (req, res) => {
  const avatarlocalPath = req.file?.path;

  if (!avatarlocalPath) {
    throw new ApiError(400, "Avatar file is missing");
  }

  const avatar = await uploadOnColudinary(avatarlocalPath);

  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading the avatar");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url,
      },
    },
    { new: true }
  ).select("-password");

  return res
  .status(200).
  json(
    new ApiResponse(
        200,
        user,
        "Avatar updated successfully"
    )
  );
});

const updateUserCoverImage = asynchandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path;

  if (!coverImageLocalPath) {
    throw new ApiError(400, "coverImage file is missing");
  }

  const coverImage = await uploadOnColudinary(coverImageLocalPath);

  if (!coverImage.url) {
    throw new ApiError(400, "something went wrong while uploading coverImage");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    {
      new: true,
    }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "coverImage updated succesfully"));
});

const getUserChannelProfile = asynchandler(async (req, res) => {
  
  const { username } = req.params;

  if (!username?.trim()) {
    throw new ApiError(400, "username is missing ");
  }

  //aggregation pipeline
  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribeTo",
      },
    },
    {
      $addFields: {
        subscriberCount: {
          $size: "$subscribers",
        },
        channelsSubscribedToCount: {
          $size: "$subscribeTo",
        },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        subscriberCount: 1,
        channelsSubscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  if (!channel?.length) {
    throw new ApiError(404, "channel does not exist");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, channel[0], "user channel fetched succesfully ")
    );
});

const getWatchHistory = asynchandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        // Note: In aggregation pipelines, _id remains a raw ObjectId (no auto-casting by Mongoose).
        // So when comparing with req.user._id (which is a string), we must manually convert it to ObjectId
        // to ensure correct matching, e.g., using new mongoose.Types.ObjectId(req.user._id).
        _id: new mongoose.Types.ObjectId(req.user._id)
      },
    },
    {
        $lookup: {
            from: "videos",
            localField: "watchHistory",
            foreignField: "_id",
            as: "watchHistory",
            //subpipeline
            pipeline: [
                {
                    $lookup: {
                        from: "users",
                        localField: "owner",
                        foreignField: "_id",
                        as: "owner",
                        pipeline: [
                            {
                                $project: {
                                    fullName: 1,
                                    username: 1,
                                    avatar: 1
                                }
                            }
                        ]
                    }
                },
                //for making the converting the projected array of owner as object
                {
                    $addFields: {
                        owner: {
                            $first: "$owner"
                        }
                    }
                }
            ]
        }
    }
  ]);

  return res
  .status(200)
  .json(
    new ApiResponse(
        200,
        user[0].watchHistory,
        "watch history fetched sucessfully"
    )
  )
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory
};
