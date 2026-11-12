import { destroySession } from "@/server/auth";
import { NextResponse } from "next/server";

export async function POST() {
  await destroySession();
  return NextResponse.json({ data: { ok: true } });
}
