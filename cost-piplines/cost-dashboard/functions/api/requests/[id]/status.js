import { readFromR2, writeToR2, jsonResponse, handleCors } from '../../../lib/r2.js';

// Handle CORS preflight
export async function onRequestOptions() {
  return handleCors();
}

// PUT /api/requests/:id/status — Admin update request status in R2
export async function onRequestPut(context) {
  const { env, params } = context;
  const id = params.id;

  try {
    const { status, adminNotes, reviewedBy } = await context.request.json();

    const { data: requests, actualKey } = await readFromR2(
      env,
      'accound_request.json',
      'account_requests.json',
      []
    );

    const index = requests.findIndex((r) => r.id === id);

    if (index === -1) {
      return jsonResponse({ error: 'Request not found in R2' }, 404);
    }

    requests[index] = {
      ...requests[index],
      status: status || requests[index].status,
      adminNotes: adminNotes ?? requests[index].adminNotes,
      reviewedBy: reviewedBy || 'Admin',
      reviewedAt: new Date().toISOString(),
    };

    await writeToR2(env, actualKey || 'accound_request.json', requests);

    return jsonResponse({ success: true, data: requests[index] });
  } catch (err) {
    return jsonResponse({ error: 'R2_ERROR', message: err.message }, 500);
  }
}
