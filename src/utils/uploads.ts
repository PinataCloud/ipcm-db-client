import { pinata } from "./config";
import { DbVersionManifest } from "./dbVersioning";

export async function uploadFile(file: File | DbVersionManifest): Promise<string> {
  try {
    const req = await fetch(`${import.meta.env.VITE_SERVER_URL}/presigned_url`);
    console.log(req.statusText)
    const res = await req.json();
    const url = res.url;

    if (file instanceof File) {
      const { cid } = await pinata.upload.public.file(file).url(url)
      return cid
    }

    const { cid } = await pinata.upload.public.json(file).url(url)
    return cid

  } catch (error) {
    console.log(error)
    return error as string
  }
}
