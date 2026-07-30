import { config } from "dotenv";

export default function setup() {
  config({ path: ".env", quiet: true });
}
