import { getSessionUser } from "@/server/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }
  return NextResponse.json({ data: user });
}
