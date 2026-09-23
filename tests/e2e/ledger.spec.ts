import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Silika#Dev2026";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("TL records a transaction, PIC verifies it (maker-checker)", async ({ page }) => {
  const description = `E2E penagihan ${Date.now()}`;

  await login(page, "tl1@silika.local");
  await expect(page.getByRole("link", { name: "BDL-001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "BDL-002" })).toHaveCount(0); // out of TL scope
  await page.getByRole("link", { name: "BDL-001" }).click();
  await page.getByRole("link", { name: "Buku Besar Transaksi" }).click();
  await page.getByRole("link", { name: "+ Catat transaksi" }).click();
  await page.getByLabel("Jenis transaksi").selectOption("PENAGIHAN_PIUTANG");
  await page.getByLabel("Uraian transaksi").fill(description);
  await page.getByLabel("Kas diterima").fill("1.500.000");
  await page.getByLabel("Pengurangan baki debet (gross)").fill("2.000.000");
  await page.getByLabel("Nama pihak lawan").fill("Debitur E2E");
  await page.getByRole("button", { name: "Simpan & ajukan verifikasi" }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  const row = page.getByRole("row").filter({ hasText: description });
  await expect(row.getByText("Menunggu verifikasi")).toBeVisible();
  await expect(row.getByRole("button", { name: "Verifikasi" })).toHaveCount(0); // TL cannot verify

  await login(page, "pic1@silika.local");
  await page.getByRole("link", { name: "BDL-001" }).click();
  await page.getByRole("link", { name: "Buku Besar Transaksi" }).click();
  await page.getByRole("link", { name: description }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Verifikasi & posting" }).click();
  await expect(page.getByText("Terverifikasi").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kas dan Setara Kas" })).toBeVisible(); // posting lines generated
});

test("Kadiv approves the pending LAPAN from the approval inbox", async ({ page }) => {
  await login(page, "kadiv1@silika.local");
  await page.getByRole("link", { name: /Antrian Persetujuan/ }).click();
  const row = page.getByRole("row").filter({ hasText: "LAPAN BDL-001" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Setujui" }).click();
  await expect(page.getByText("Tidak ada dokumen yang menunggu tindakan Anda")).toBeVisible();
});

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
