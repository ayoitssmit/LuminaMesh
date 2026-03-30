import { NextResponse } from "next/server";

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return NextResponse.json(
      { error: "Twilio credentials are not configured" },
      { status: 500 }
    );
  }

  try {
    const token = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          // The lifespan of the temporary TURN token (in seconds, 24 hours max)
          Ttl: "86400",
        }),
      }
    );

    if (!response.ok) {
        console.error("Failed to fetch Twilio token", await response.text());
        return NextResponse.json(
            { error: "Failed to generate Network Traversal token" },
            { status: 500 }
        );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Twilio TURN API Error]", error);
    return NextResponse.json(
      { error: "Failed to process Network Traversal request" },
      { status: 500 }
    );
  }
}
