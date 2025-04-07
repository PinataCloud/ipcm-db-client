import { PinataSDK } from "pinata";
import { createWalletClient, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { abi } from "./contract";

export const pinata = new PinataSDK({
  pinataJwt: "",
  pinataGateway: import.meta.env.VITE_GATEWAY_URL,
});

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

export const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: http(),
});

export const ipcmContract = {
  address: import.meta.env.VITE_IPCM_CONTRACT_ADDRESS as `0x`,
  abi: abi,
};
