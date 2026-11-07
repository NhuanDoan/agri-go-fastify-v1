import { Type, type Static } from "@sinclair/typebox";
import type { MultipartFile } from "@fastify/multipart";

export const CloudinaryImageBody = Type.Object(
  {
    secureUrl: Type.String({
      minLength: 1,
      maxLength: 500,
      pattern: "^https://",
    }),
    publicId: Type.String({ minLength: 1, maxLength: 255 }),
    resourceType: Type.Literal("image"),
    format: Type.Optional(Type.String({ maxLength: 10 })),
    bytes: Type.Optional(Type.Integer({ minimum: 1 })),
    width: Type.Optional(Type.Integer({ minimum: 1 })),
    height: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type CloudinaryImageBody = Static<typeof CloudinaryImageBody>;

// @fastify/multipart attaches parsed parts before validation so the file can
// be required by both the runtime validator and the OpenAPI schema.
export const ImageUploadMultipartBody = Type.Object({
  file: Type.Unsafe({ isFile: true }),
});
export type ImageUploadMultipartBody = {
  file: MultipartFile;
};

export function getImageUploadFile(body: unknown): MultipartFile | undefined {
  if (typeof body !== "object" || body === null || !("file" in body)) {
    return undefined;
  }
  const file = body.file;
  return typeof file === "object" &&
    file !== null &&
    "type" in file &&
    file.type === "file" &&
    "mimetype" in file &&
    typeof file.mimetype === "string" &&
    "toBuffer" in file &&
    typeof file.toBuffer === "function"
    ? (file as MultipartFile)
    : undefined;
}

export const ImageSchema = Type.Object({
  id: Type.Integer(),
  url: Type.String(),
  publicId: Type.String(),
  isPrimary: Type.Boolean(),
  sortOrder: Type.Integer(),
});
