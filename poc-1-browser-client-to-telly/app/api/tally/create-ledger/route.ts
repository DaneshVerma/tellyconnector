import { NextResponse } from "next/server";
import { buildCreateLedgerRequest, postToTally } from "@/lib/tallyProxy";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, parent, mock } = body as {
      name?: string;
      parent?: string;
      mock?: boolean;
    };

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Missing ledger name" },
        { status: 400 },
      );
    }

    if (mock) {
      const mockXml = `<TALLYMESSAGE><LEDGER NAME="${name}"><NAME>${name}</NAME><PARENT>${parent || "Sundry Debtors"}</PARENT></LEDGER></TALLYMESSAGE>`;
      return NextResponse.json({
        ok: true,
        status: 200,
        text: mockXml,
        request: "(mock)",
      });
      if (mock) {
        const mockXml = `<TALLYMESSAGE><LEDGER NAME="${name}"><NAME>${name}</NAME><PARENT>${parent || "Sundry Debtors"}</PARENT></LEDGER></TALLYMESSAGE>`;
        return NextResponse.json({
          ok: true,
          status: 200,
          text: mockXml,
          parsed: { TALLYMESSAGE: { LEDGER: { NAME: name, PARENT: parent || "Sundry Debtors" } } },
          request: "(mock)",
        });
      }

      const xml = buildCreateLedgerRequest(name, parent || undefined);
      const res = await postToTally(xml);

      return NextResponse.json({
        ok: res.ok,
        status: res.status,
        text: res.text,
        parsed: res.parsed ?? null,
        request: xml,
      });
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
