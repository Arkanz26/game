// Point the application's DB client at the disposable test database before any module loads it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/silika_test";
process.env.DATABASE_POOL_MAX = "5";
