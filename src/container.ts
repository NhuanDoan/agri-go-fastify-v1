import type { FastifyBaseLogger } from "fastify";
import type { Knex } from "knex";
import type { TokenService } from "./common/security/token.service.js";
import type { AppConfig } from "./config/env.js";
import { AuthRepository } from "./modules/auth/auth.repository.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { OtpRepository } from "./modules/auth/otp.repository.js";
import { OtpService } from "./modules/auth/otp.service.js";
import { CartsRepository } from "./modules/carts/carts.repository.js";
import { CartsService } from "./modules/carts/carts.service.js";
import { CategoriesRepository } from "./modules/categories/categories.repository.js";
import { CategoriesService } from "./modules/categories/categories.service.js";
import { ChatRepository } from "./modules/chat/chat.repository.js";
import { ChatService } from "./modules/chat/chat.service.js";
import { InventoryRepository } from "./modules/inventory/inventory.repository.js";
import { InventoryService } from "./modules/inventory/inventory.service.js";
import type { MailService } from "./modules/mail/mail.service.js";
import { OrdersRepository } from "./modules/orders/orders.repository.js";
import { OrdersService } from "./modules/orders/orders.service.js";
import { PaymentsRepository } from "./modules/payments/payments.repository.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
import { VnpayClient } from "./modules/payments/vnpay.js";
import { ProductsRepository } from "./modules/products/products.repository.js";
import { ProductsService } from "./modules/products/products.service.js";
import { ProductImagesRepository } from "./modules/products/product-images.repository.js";
import { ProductImagesService } from "./modules/products/product-images.service.js";
import { ReviewsRepository } from "./modules/reviews/reviews.repository.js";
import { ReviewsService } from "./modules/reviews/reviews.service.js";
import { UsersRepository } from "./modules/users/users.repository.js";
import { UsersService } from "./modules/users/users.service.js";
import { CloudinaryService } from "./modules/media/cloudinary.service.js";
import { CloudinaryCleanupRepository } from "./modules/media/cloudinary-cleanup.repository.js";
import { CloudinaryCleanupService } from "./modules/media/cloudinary-cleanup.service.js";

export function createServices(deps: {
  knex: Knex;
  config: AppConfig;
  tokens: TokenService;
  mail: MailService;
  log: FastifyBaseLogger;
}) {
  const { knex, config, tokens, mail, log } = deps;

  const usersRepo = new UsersRepository(knex);
  const authRepo = new AuthRepository(knex);
  const categoriesRepo = new CategoriesRepository(knex);
  const media = new CloudinaryService(config);
  const cleanup = new CloudinaryCleanupService(
    new CloudinaryCleanupRepository(knex),
    media,
    log,
  );
  const productsRepo = new ProductsRepository(knex);
  const productImagesRepo = new ProductImagesRepository(knex);
  const inventoryRepo = new InventoryRepository();
  const cartsRepo = new CartsRepository();
  const ordersRepo = new OrdersRepository();
  const paymentsRepo = new PaymentsRepository();
  const products = new ProductsService(
    knex,
    productsRepo,
    categoriesRepo,
    inventoryRepo,
    productImagesRepo,
    cleanup,
  );
  const otp = new OtpService(
    knex,
    new OtpRepository(),
    config.OTP_SECRET,
    config.OTP_TTL_MINUTES,
    config.OTP_RESEND_COOLDOWN_SECONDS,
  );

  // an unpaid VNPay order is cancelled 5 minutes after the LAST payment link could have been created
  const unpaidGraceMinutes = config.VNPAY_EXPIRE_MINUTES + 5;

  // empty strings from .env count as "not set"
  const vnpay =
    config.VNPAY_TMN_CODE && config.VNPAY_HASH_SECRET
      ? new VnpayClient({
          tmnCode: config.VNPAY_TMN_CODE,
          hashSecret: config.VNPAY_HASH_SECRET,
          url: config.VNPAY_URL,
          returnUrl: config.VNPAY_RETURN_URL,
          expireMinutes: config.VNPAY_EXPIRE_MINUTES,
        })
      : null;

  const payments = new PaymentsService(
    knex,
    paymentsRepo,
    ordersRepo,
    usersRepo,
    mail,
    vnpay,
    {
      frontendResultUrl: config.FRONTEND_PAYMENT_RESULT_URL,
      unpaidGraceMinutes,
    },
    log,
  );

  return {
    media,
    cleanup,
    users: new UsersService(usersRepo, config.BCRYPT_ROUNDS),
    auth: new AuthService(
      knex,
      usersRepo,
      authRepo,
      tokens,
      otp,
      mail,
      config.BCRYPT_ROUNDS,
    ),
    categories: new CategoriesService(knex, categoriesRepo, media, cleanup),
    inventory: new InventoryService(knex, inventoryRepo),
    products,
    productImages: new ProductImagesService(
      knex,
      productImagesRepo,
      productsRepo,
      media,
      cleanup,
    ),
    carts: new CartsService(knex, cartsRepo, productsRepo),
    payments,
    orders: new OrdersService(
      knex,
      ordersRepo,
      cartsRepo,
      inventoryRepo,
      usersRepo,
      mail,
      payments,
      {
        shippingFee: config.SHIPPING_FEE,
        unpaidGraceMinutes,
      },
    ),
    reviews: new ReviewsService(knex, new ReviewsRepository(), products),
    chat: new ChatService(knex, new ChatRepository()),
  };
}

export type Services = ReturnType<typeof createServices>;
