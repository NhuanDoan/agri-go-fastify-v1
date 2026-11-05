import { Type, type Static } from "@sinclair/typebox";

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

// Multipart is parsed lazily by request.file(), so Fastify does not expose a
// body to its validator before the handler runs. The field itself remains
// required in the OpenAPI schema.
export const ImageUploadMultipartBody = Type.Optional(
  Type.Object({
    file: Type.String({ format: "binary" }),
  }),
);

export const ImageSchema = Type.Object({
  id: Type.Integer(),
  url: Type.String(),
  publicId: Type.String(),
  isPrimary: Type.Boolean(),
  sortOrder: Type.Integer(),
});
