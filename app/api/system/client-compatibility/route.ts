// Public, static protocol metadata. No request, account or deployment data.
export function GET() {
  return Response.json(
    { service: "metis", schemaVersion: 1, supportedVersions: [1] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
