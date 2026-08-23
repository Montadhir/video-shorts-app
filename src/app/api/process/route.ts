export async function POST(request: Request) {
  const body = await request.json();
  const { url } = body;

  console.log("Received URL:", url);

  return Response.json({
    message: "Request received by the server",
    url,
  });
}
