import { createApp } from "./server.js";

const port = Number(process.env.ADMIN_PORT || process.env.PORT || 3001);

createApp({ mode: "admin" }).listen(port, "127.0.0.1", () => {
  console.log(`Lucky wheel admin server is running at http://127.0.0.1:${port}`);
});
