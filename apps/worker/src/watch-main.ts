import { watchAndIngest } from "./watch.js";

watchAndIngest().catch((err) => {
  console.error(err);
  process.exit(1);
});
