import { NextResponse } from "next/server";
import { buildExportLedgersRequest, postToTally } from "@/lib/tallyProxy";

export async function GET(request: Request) {
  const url = request.nextUrl.searchParams.get("url") || undefined;
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  const name = request.nextUrl.searchParams.get("name") || null;

  try {
    if (mock) {
      const mockXml = `<TALLYMESSAGE><LEDGER NAME="${name || "Test Ledger"}"><NAME>${name || "Test Ledger"}</NAME></LEDGER></TALLYMESSAGE>`;
      return NextResponse.json({
        ok: true,
        status: 200,
        text: mockXml,
        parsed: { TALLYMESSAGE: { LEDGER: { NAME: name || "Test Ledger" } } },
        request: "(mock)",
      });
    }

    const xml = buildExportLedgersRequest();
    const res = await postToTally(xml, { url });

    // Return raw response; client may parse or search for the ledger name
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      text: res.text,
      parsed: res.parsed ?? null,
      request: xml,
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, status: null, error: message },
      { status: 502 },
    );
  }
}
