import { seedAll } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/server/db/seed/demo";
import { pg } from "@/server/db/client";

seedAll({ scenario: !process.argv.includes("--no-scenario") })
  .then(() => {
    console.log(`Seed selesai. Login demo: pic1@silika.local / ${DEMO_PASSWORD} (lihat README untuk pengguna lain).`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
