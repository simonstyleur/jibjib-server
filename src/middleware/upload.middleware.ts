import multer from "multer";
import { AppError } from "./error.middleware";
import { MAX_PHOTO_SIZE_KB, MAX_VOICE_SIZE_KB } from "../constants/limits";

const storage = multer.memoryStorage();

/**
 * Multer file filter for image uploads (jpg, png).
 */
function imageFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const allowed = ["image/jpeg", "image/png"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError("INVALID_FILE_TYPE", 400, "Only JPG and PNG images are allowed."));
  }
}

/**
 * Multer file filter for photo uploads (jpg, png, webp).
 */
function photoFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError("INVALID_FILE_TYPE", 400, "Only JPG, PNG, and WebP images are allowed."));
  }
}

/**
 * Multer file filter for voice uploads (opus, m4a, mp4).
 */
function voiceFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const allowed = ["audio/opus", "audio/m4a", "audio/mp4", "audio/x-m4a", "audio/mpeg"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError("INVALID_FILE_TYPE", 400, "Only Opus, M4A, and MP4 audio files are allowed."));
  }
}

/**
 * Upload middleware for user avatar images.
 * Accepts a single file under the field name 'avatar'.
 * Max size: 500KB. Allowed types: JPG, PNG.
 */
export const uploadAvatar = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE_KB * 1024 },
  fileFilter: imageFilter,
}).single("avatar");

/**
 * Upload middleware for item photos.
 * Accepts a single file under the field name 'photo'.
 * Max size: 500KB. Allowed types: JPG, PNG, WebP.
 */
export const uploadPhoto = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE_KB * 1024 },
  fileFilter: photoFilter,
}).single("photo");

/**
 * Upload middleware for voice notes.
 * Accepts a single file under the field name 'voice'.
 * Max size: 500KB. Allowed types: Opus, M4A, MP4.
 */
export const uploadVoice = multer({
  storage,
  limits: { fileSize: MAX_VOICE_SIZE_KB * 1024 },
  fileFilter: voiceFilter,
}).single("voice");
