import { v2 as cloudinary } from "cloudinary";
import { Readable } from "node:stream";
import { AppError } from "../../common/errors/app-error.js";
import type { AppConfig } from "../../config/env.js";
import type { CloudinaryImageBody } from "./media.schema.js";
import { validateImageUpload } from "./image-policy.js";

export class CloudinaryService {
  private readonly enabled: boolean;

  constructor(private readonly config: AppConfig) {
    this.enabled = Boolean(
      config.CLOUDINARY_CLOUD_NAME &&
        config.CLOUDINARY_API_KEY &&
        config.CLOUDINARY_API_SECRET,
    );
    if (this.enabled) {
      cloudinary.config({
        cloud_name: config.CLOUDINARY_CLOUD_NAME,
        api_key: config.CLOUDINARY_API_KEY,
        api_secret: config.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
  }

  folder(resource: "categories" | "products", id: number): string {
    return `${this.config.CLOUDINARY_FOLDER}/${resource}/${id}`;
  }

  async destroy(publicId: string): Promise<void> {
    this.assertEnabled();
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
  }

  async verifyImage(
    image: CloudinaryImageBody,
    folder: string,
  ): Promise<CloudinaryImageBody> {
    this.assertEnabled();
    this.validateImage(image, folder);
    let resource: {
      public_id?: string;
      secure_url?: string;
      resource_type?: string;
      format?: string;
      bytes?: number;
      width?: number;
      height?: number;
    };
    try {
      resource = await cloudinary.api.resource(image.publicId, {
        resource_type: "image",
      });
    } catch (error) {
      const status = (error as { http_code?: number }).http_code;
      if (status === 404) {
        throw new AppError(422, "Cloudinary image was not found");
      }
      throw new AppError(503, "Unable to verify the Cloudinary image");
    }
    if (
      resource.resource_type !== "image" ||
      resource.public_id !== image.publicId ||
      !resource.secure_url ||
      !resource.secure_url.startsWith("https://")
    ) {
      throw new AppError(422, "Cloudinary image metadata is invalid");
    }
    return {
      secureUrl: resource.secure_url,
      publicId: resource.public_id,
      resourceType: "image",
      format: resource.format,
      bytes: resource.bytes,
      width: resource.width,
      height: resource.height,
    };
  }

  async uploadImage(
    buffer: Buffer,
    folder: string,
    mimetype: string,
  ): Promise<CloudinaryImageBody> {
    this.assertEnabled();
    validateImageUpload(mimetype, buffer);
    return new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        { folder, resource_type: "image" },
        (error, result) => {
          if (error || !result) {
            reject(new AppError(502, "Cloudinary image upload failed"));
            return;
          }
          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
            resourceType: "image",
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
          });
        },
      );
      Readable.from(buffer).pipe(upload);
    });
  }

  validateImage(
    image: CloudinaryImageBody,
    folder: string,
  ): CloudinaryImageBody {
    this.assertEnabled();
    if (!image.publicId.startsWith(`${folder}/`)) {
      throw new AppError(422, "Image does not belong to this resource");
    }
    if (image.bytes !== undefined && image.bytes > 5 * 1024 * 1024) {
      throw new AppError(422, "Image must be 5 MB or smaller");
    }
    if (image.format && !["jpg", "jpeg", "png", "webp"].includes(image.format.toLowerCase())) {
      throw new AppError(422, "Only JPEG, PNG, and WebP images are supported");
    }
    return image;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new AppError(503, "Image storage is not configured");
    }
  }
}
