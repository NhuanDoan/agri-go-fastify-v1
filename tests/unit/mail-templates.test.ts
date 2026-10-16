import { describe, expect, it } from "vitest";
import { esc, renderMail } from "../../src/modules/mail/mail.templates.js";

const data = { fullName: "Nguyen Van A", code: "123456", ttlMinutes: 10 };

describe("mail templates", () => {
  it("puts the code and the lifetime in both the HTML and the text part", () => {
    const mail = renderMail("AgriGo", {
      type: "email_verification",
      to: "a@example.com",
      data,
    });
    expect(mail.subject).toBe("[AgriGo] Mã xác thực email");
    expect(mail.html).toContain("123456");
    expect(mail.text).toContain("123456");
    expect(mail.text).toContain("10 phút");
  });

  it("renders a different message for password reset", () => {
    const mail = renderMail("AgriGo", {
      type: "password_reset",
      to: "a@example.com",
      data,
    });
    expect(mail.subject).toBe("[AgriGo] Mã đặt lại mật khẩu");
  });

  it("escapes HTML in user-controlled values", () => {
    const mail = renderMail("AgriGo", {
      type: "email_verification",
      to: "a@example.com",
      data: { ...data, fullName: "<script>alert(1)</script>" },
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("esc handles every special character", () => {
    expect(esc(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("renders the order confirmation with items, total and an escaped address", () => {
    const mail = renderMail("AgriGo", {
      type: "order_placed",
      to: "a@example.com",
      data: {
        fullName: "A",
        orderCode: "AG250101ABCDEF12",
        paymentMethod: "cod",
        shippingAddress: "<b>1 Le Loi</b>",
        items: [{ name: "Mango", quantity: 2, unit: "kg", price: 90000 }],
        total: 180000,
      },
    });
    expect(mail.subject).toContain("AG250101ABCDEF12");
    expect(mail.html).toContain("Mango");
    expect(mail.html).toMatch(/180\D?000/);
    expect(mail.html).toContain("&lt;b&gt;1 Le Loi");
    expect(mail.html).not.toContain("<b>1 Le Loi");
    expect(mail.text).toContain("COD");
  });

  it("renders the payment confirmation", () => {
    const mail = renderMail("AgriGo", {
      type: "payment_success",
      to: "a@example.com",
      data: { fullName: "A", orderCode: "AG250101ABCDEF12", amount: 180000 },
    });
    expect(mail.subject).toContain("Thanh toán thành công");
    expect(mail.subject).toContain("AG250101ABCDEF12");
    expect(mail.text).toMatch(/180\D?000/);
  });
});
