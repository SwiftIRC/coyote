import { uuidV4 } from "../src/core/uuid";

test("RFC 4122 v4 shape", () => {
  let i = 0;
  const seq = () => ((i++ * 0.137) % 1);
  const id = uuidV4(seq);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(uuidV4(Math.random)).not.toBe(uuidV4(Math.random));
});
