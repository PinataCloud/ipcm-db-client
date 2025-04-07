import { publicClient } from "./config";

export interface DbVersionManifest {
  cid: string;
  timestamp: number;
  blockNumber: number;
  blockTimestamp: number;
  prevVersion: string | null;
  changeLog: string[];
  signature?: string; // Optional: Add user signature for additional verification
}

export async function createVersionManifest(
  cid: string,
  prevCid: string | null,
  changes: string[] = []
): Promise<DbVersionManifest> {
  // Get the latest block for timestamp
  const latestBlock = await publicClient.getBlock();

  return {
    cid,
    timestamp: Date.now(),
    blockNumber: Number(latestBlock.number),
    blockTimestamp: Number(latestBlock.timestamp),
    prevVersion: prevCid,
    changeLog: changes,
  };
}
