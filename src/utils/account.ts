import { privateKeyToAccount } from "viem/accounts";

export const account = privateKeyToAccount(
  import.meta.env.PRIVATE_KEY as `0x`,
);
