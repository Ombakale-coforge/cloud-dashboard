import { readFromR2, writeToR2, jsonResponse, handleCors } from '../lib/r2.js';

// Handle CORS preflight
export async function onRequestOptions() {
  return handleCors();
}

// GET /api/requests — Fetch all account requests from R2
export async function onRequestGet(context) {
  const { env } = context;

  try {
    const { data: requests } = await readFromR2(
      env,
      'accound_request.json',
      'account_requests.json',
      []
    );
    return jsonResponse({ success: true, data: requests });
  } catch (err) {
    return jsonResponse({ error: 'R2_ERROR', message: err.message }, 500);
  }
}

// POST /api/requests — Submit a new account request to R2
export async function onRequestPost(context) {
  const { env } = context;

  try {
    const requestData = await context.request.json();

    if (!requestData || !requestData.projectName) {
      return jsonResponse(
        { error: 'Project name and details are required' },
        400
      );
    }

    const { data: requests, actualKey } = await readFromR2(
      env,
      'accound_request.json',
      'account_requests.json',
      []
    );

    const newRecord = {
      ...requestData,
      id: requestData.id || `req-${Date.now().toString(36)}`,
      submittedAt: requestData.submittedAt || new Date().toISOString(),
      status: requestData.status || 'pending',
    };

    requests.unshift(newRecord);
    await writeToR2(env, actualKey || 'accound_request.json', requests);

    return jsonResponse({ success: true, data: newRecord }, 201);
  } catch (err) {
    return jsonResponse({ error: 'R2_ERROR', message: err.message }, 500);
  }
}
