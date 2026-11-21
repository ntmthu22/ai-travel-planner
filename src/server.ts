import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";

const config = loadConfig(process.env);
const store = new Store();
for (const u of config.seedUsers) {
  store.addUser({
    id: u.id,
    name: u.id,
    email: `${u.id}@example.invalid`,
    password: u.password,
    interests: [],
  });
}
createApp(store, config.deps).listen(config.port, () => {
  console.log(`listening on ${config.port} (dataset ${config.deps.dataset?.version})`);
});
