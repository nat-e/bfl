/* @ts-self-types="./index.d.mts" */
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
//#region src/errors.ts
const MARK = Symbol.for("@bfl/sdk/error");
const TRANSIENT = /* @__PURE__ */ new Set([
	"rate_limited",
	"server_error",
	"network_error",
	"timeout"
]);
/** An error from the SDK or the BFL API. `code` tells what went wrong. */
var BflError = class extends Error {
	/** What went wrong. */
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "BflError";
		this.code = code;
		Object.defineProperty(this, MARK, { value: true });
	}
	/** `true` when the error is temporary: calling again later may work. */
	get retryable() {
		return TRANSIENT.has(this.code);
	}
	/**
	* `true` when `value` is a `BflError`. Unlike `instanceof`, it also works when the app has
	* several copies of the SDK installed.
	*/
	static isInstance(value) {
		return typeof value === "object" && value !== null && MARK in value;
	}
};
//#endregion
//#region src/version.ts
const VERSION = "0.0.0";
const USER_AGENT = `bfl-sdk-js/${VERSION} ${/^[^\s/]+\/[^\s/]+/.exec(globalThis.navigator?.userAgent ?? "")?.[0] ?? ""}`.trim();
const TIMEOUT_MS = 3e4;
const MAX_TIMER_MS = 2 ** 31 - 1;
var HttpClient = class {
	#host;
	#apiKey;
	#fetch;
	constructor(config) {
		this.#host = config.host;
		this.#apiKey = config.apiKey;
		const fetchFn = config.fetch;
		this.#fetch = (input, init) => fetchFn(input, init);
	}
	/**
	* Allow get queries to a custom URL for polling.
	* This will make sure the URL is safe to prevent sending the API key to untrusted hosts.
	*/
	async getCustomUrl(url, options) {
		if (!this.#trusted(url)) throw new BflError("invalid_job", `Won't send the API key to ${url}: pollingUrl must be a BFL host.`);
		return this.request("GET", url, void 0, options);
	}
	async post(path, body, options) {
		const url = `${this.#host}${path}`;
		return this.request("POST", url, body, options);
	}
	async request(method, url, body, options) {
		const headers = {
			"x-key": this.#apiKey,
			accept: "application/json",
			"user-agent": USER_AGENT
		};
		if (body) headers["content-type"] = "application/json";
		const timeoutController = new AbortController();
		const timeoutMs = Math.min(options?.timeoutMs ?? TIMEOUT_MS, MAX_TIMER_MS);
		const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
		let response;
		let text;
		try {
			response = await this.#fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : void 0,
				signal: AbortSignal.any(options?.signal ? [options.signal, timeoutController.signal] : [timeoutController.signal])
			});
			text = await response.text();
		} catch (cause) {
			options?.signal?.throwIfAborted();
			if (timeoutController.signal.aborted) throw new BflError("timeout", `The request did not respond in the allotted time. Try again later.`);
			throw new BflError("network_error", `Could not reach ${new URL(url).origin}. Make sure this is a valid BFL API or check the status page at https://status.bfl.ml`, { cause });
		} finally {
			clearTimeout(timer);
		}
		return this.#handleResponse(response, text);
	}
	#trusted(pollingUrl) {
		if (!URL.canParse(pollingUrl)) return false;
		const { protocol, hostname } = new URL(pollingUrl);
		return protocol === "https:" && (hostname === "bfl.ai" || hostname.endsWith(".bfl.ai"));
	}
	#handleResponse(response, body) {
		if (response.ok) try {
			return JSON.parse(body);
		} catch {
			throw new BflError("unknown_error", `The returned response was not valid JSON.`);
		}
		const { status } = response;
		const errorMessage = parseErrorResponse(body);
		if (status >= 500) throw new BflError("server_error", `BFL API Internal error. Check the status page at https://status.bfl.ml`);
		if (status === 403) throw new BflError("invalid_api_key", "The provided API key was invalid");
		if (status === 422 && errorMessage === "Invalid API key format") throw new BflError("invalid_api_key", "The provided API key was malformed");
		if (status === 404) throw new BflError("job_not_found", "BFL has no such job: the id is wrong, or BFL already deleted the finished job (it keeps them for a few hours). Save the job as failed.");
		if (status === 402) throw new BflError("insufficient_credits", `${errorMessage}. Add credits, then start again.`);
		if (status === 429) throw new BflError("rate_limited", `${errorMessage}. Try again later.`);
		if (status === 422) throw new BflError("invalid_request", `The request was invalid: ${errorMessage}.`);
		throw new BflError("unknown_error", `${errorMessage}`);
	}
};
/**
* Parses a JSON error body from an API response
**/
function parseErrorResponse(body) {
	let detail;
	try {
		detail = JSON.parse(body).detail;
	} catch {
		return;
	}
	if (typeof detail === "string") return detail;
	if (!Array.isArray(detail)) return;
	return detail.map(({ loc, msg }) => {
		const path = (loc[0] === "body" ? loc.slice(1) : loc).join(".");
		return path ? `${path}: ${msg}` : msg;
	}).join("; ");
}
//#endregion
//#region src/job.ts
function advanceInProgress(job, fields) {
	return {
		...job,
		...fields
	};
}
function advanceToReady(job, fields) {
	return {
		...sharedFields(job),
		status: "ready",
		...fields
	};
}
function advanceToFailed(job, fields) {
	return {
		...sharedFields(job),
		status: "failed",
		...fields
	};
}
function sharedFields(job) {
	return {
		id: job.id,
		input: job.input,
		startedAt: job.startedAt
	};
}
//#endregion
//#region src/utils.ts
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		signal?.throwIfAborted();
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
//#region src/resources/videos/models/video_model.ts
/**
* Base class for a video generation model.
* INFO: At the moment Flux3 is the only video model, but this showcase how I would extend the code
* to support multiple models
*/
var VideoModel = class {};
//#endregion
//#region src/resources/videos/models/flux3.ts
var VideoModelFlux3 = class extends VideoModel {
	id = "flux3";
	endpoint = "/v1/flux-3-video";
	makeFromTextBody(input) {
		return {
			...this.#buildSubmitBody(input),
			mode: "t2v",
			prompt: input.prompt.trim()
		};
	}
	/**
	* Build the part of the body shared between all modes for the submit endpoint.
	* INFO: I do not set any defaults here. Defaults should be set on the API side so they are only set once
	* and there is no discrepancies.
	**/
	#buildSubmitBody(input) {
		return {
			duration: input.duration,
			resolution: input.resolution,
			aspect_ratio: input.aspectRatio,
			generate_audio: input.audio,
			user: input.user,
			version: input.version,
			...input.extra
		};
	}
};
//#endregion
//#region src/resources/videos.ts
const MODELS = { flux3: new VideoModelFlux3() };
/** Module for generating videos.
* Accessed with `new Bfl().videos`
* Call {@link Videos.fromText} to generate a video from a prompt.
**/
var Videos = class {
	#http;
	#hooks = [];
	constructor(http) {
		this.#http = http;
	}
	/**
	* Registers hooks the SDK calls for every video job of this client: when a job can't be
	* started, when a check finds its progress or status changed, and when it is ready or failed.
	* Hooks run in {@link Videos.fromText} and {@link Videos.check}, so also in {@link Videos.wait}.
	*
	* @param hooks - The hooks to call. Every hook is optional.
	*
	* @example
	* ```ts
	* bfl.videos.registerHooks({
	*   onJobProgress: (job) => progressBar.update(job.progress ?? 0),
	* })
	* const job = await bfl.videos.wait(started)
	* ```
	*/
	registerHooks(hooks) {
		this.#hooks.push(hooks);
	}
	/**
	* Starts generating a video from a text prompt.
	*
	* @param input - The settings for video generation
	* @param options - Options for configuring the HTTP request
	*
	* @returns The asynchronous job for the processing.
	* Save it, then pass it to {@link Videos.check} to get its status.
	* @throws {@link BflError} when the video can't be started, e.g. `invalid_request`,
	* `insufficient_credits` or `rate_limited`.
	*
	* @example
	* ```ts
	* const job = await bfl.videos.fromText({ model: 'flux3', prompt: 'A cat surfing a wave' })
	* await db.save(JSON.stringify(job))
	* ```
	*/
	async fromText(input, options) {
		const startedAt = Date.now();
		const model = getModelOrThrow(input.model);
		try {
			const response = await this.#http.post(model.endpoint, model.makeFromTextBody(input), options);
			return {
				id: response.id,
				status: "in_progress",
				pollingUrl: response.polling_url,
				cost: response.cost ?? void 0,
				input,
				startedAt
			};
		} catch (err) {
			if (err instanceof BflError) await this.#runHooks((hooks) => hooks.onSubmitFailed?.(input, err, startedAt));
			throw err;
		}
	}
	/**
	* Polls the API to check the status of a Job.
	* Only jobs with in_progress status are checked. Other jobs are returned unchanged.
	* The input Job will not be mutated, an updated Job object will be returned.
	* A job for which the processing failed is returned with status `failed`, not thrown.
	* Runs the registered {@link JobHooks} for the new state before returning.
	*
	* @param job - The Job to check
	* @param options - Options for configuring the HTTP request
	* @returns A copy of the Job, with the updated state
	* @throws {@link BflError} when the status can't be checked, e.g. `job_not_found` (BFL already
	* deleted the job), `invalid_job` or `network_error`.
	*
	* @example
	* ```ts
	* const job = await bfl.videos.check(JSON.parse(await db.load()))
	* if (job.status === 'ready') console.log(job.media.url)
	* ```
	*/
	async check(job, options) {
		if (job.status !== "in_progress") return job;
		const response = await this.#http.getCustomUrl(job.pollingUrl, options);
		const cost = response.cost ?? job.cost;
		if (response.status === "Ready" && response.result) {
			const updatedJob = advanceToReady(job, {
				cost,
				media: {
					url: response.result.sample,
					mimeType: "video/mp4"
				}
			});
			await this.#runHooks((hooks) => hooks.onJobReady?.(updatedJob));
			return updatedJob;
		}
		const error = toJobError(response);
		if (error) {
			const updatedJob = advanceToFailed(job, {
				error,
				cost
			});
			await this.#runHooks((hooks) => hooks.onJobFailed?.(updatedJob));
			return updatedJob;
		}
		const updatedJob = advanceInProgress(job, {
			processingStatus: response.status,
			progress: response.progress ?? job.progress,
			cost
		});
		if (updatedJob.processingStatus !== job.processingStatus || updatedJob.progress !== job.progress) await this.#runHooks((hooks) => hooks.onJobProgress?.(updatedJob));
		return updatedJob;
	}
	/**
	* Waits for a Job to complete.
	* Thif will check right away, then every `intervalMs`, until it is ready or failed.
	* Checks that throw a retryable error are skipped. There is no time limit: pass a `signal`
	* to stop.
	*
	* @param job - The Job to wait for
	* @param options - The pause between checks, and a signal to stop
	* @returns The Job, ready or failed
	* @throws {@link BflError} when a check fails with an error that is not retryable, e.g.
	* `job_not_found` or `invalid_api_key`.
	*
	* @example
	* ```ts
	* const started = await bfl.videos.fromText({ model: 'flux3', prompt: 'A cat surfing a wave' })
	* const job = await bfl.videos.wait(started, { signal: AbortSignal.timeout(3_600_000) })
	* if (job.status === 'ready') console.log(job.media.url)
	* ```
	*/
	async wait(job, options = {}) {
		const { intervalMs = 5e3, signal } = options;
		for (;;) {
			try {
				job = await this.check(job, { signal });
			} catch (err) {
				if (!BflError.isInstance(err) || !err.retryable) throw err;
			}
			if (job.status !== "in_progress") return job;
			await sleep(intervalMs, signal);
		}
	}
	async #runHooks(run) {
		await Promise.allSettled(this.#hooks.map(async (hooks) => run(hooks)));
	}
};
function toJobError(response) {
	switch (response.status) {
		case "Error": {
			const message = response.details?.error;
			return {
				type: "error",
				message: typeof message === "string" ? message : void 0
			};
		}
		case "Request Moderated":
		case "Content Moderated": {
			const reasons = response.details?.["Moderation Reasons"];
			return {
				type: response.status === "Content Moderated" ? "content_moderated" : "request_moderated",
				reasons: reasons ?? []
			};
		}
		default: return;
	}
}
function getModelOrThrow(id) {
	if (!Object.hasOwn(MODELS, id)) throw new BflError("invalid_request", `Unknown video model: ${id}. Must be one of: ${Object.keys(MODELS).join(",")}`);
	return MODELS[id];
}
//#endregion
//#region src/telemetry/core.ts
/**
* A Job lifecycle hooks that takes care of sending OpenTelemetry
* spans for each job. Each resource extends it with its own attributes.
*
* The spans will be tagged with the otel.genai attributes, providing seamless integrations with
* Langfuse and other AI observability tools
*/
var JobTelemetry = class {
	#recordContent;
	#serverAddress;
	constructor(opts) {
		this.#recordContent = opts.recordContent;
		this.#serverAddress = opts.serverAddress;
	}
	#getSpan(input, startedAt, media) {
		return {
			resourceType: this.resourceType,
			model: input.model,
			startedAt,
			attributes: this.getSpanAttributes(input),
			content: {
				prompt: input.prompt,
				output: media
			},
			userId: input.user
		};
	}
	onSubmitFailed(input, err, startedAt) {
		this.#write({
			...this.#getSpan(input, startedAt),
			error: {
				type: err.code,
				message: err.message
			}
		});
	}
	onJobReady(job) {
		this.#write({
			...this.#getSpan(job.input, job.startedAt, job.media),
			jobId: job.id,
			cost: job.cost
		});
	}
	onJobFailed(job) {
		this.#write({
			...this.#getSpan(job.input, job.startedAt),
			jobId: job.id,
			cost: job.cost,
			error: { type: job.error.type }
		});
	}
	#write(data) {
		const { error } = data;
		const finishReason = toFinishReason(error);
		const attributes = {
			"gen_ai.operation.name": "generate_content",
			"gen_ai.provider.name": "black_forest_labs",
			"gen_ai.output.type": data.resourceType,
			"server.address": this.#serverAddress,
			"gen_ai.request.model": data.model,
			...validAttributes(data.attributes),
			"gen_ai.response.finish_reasons": [finishReason]
		};
		if (data.jobId !== void 0) attributes["gen_ai.response.id"] = data.jobId;
		if (data.userId !== void 0) attributes["user.id"] = data.userId;
		if (data.cost !== void 0) {
			attributes["gen_ai.usage.cost"] = data.cost / 100;
			attributes["black_forest_labs.cost.credits"] = data.cost;
		}
		if (error) attributes["error.type"] = error.type;
		if (this.#recordContent) {
			const { prompt, output } = data.content;
			attributes["gen_ai.input.messages"] = JSON.stringify([{
				role: "user",
				parts: [{
					type: "text",
					content: prompt
				}]
			}]);
			if (output !== void 0) attributes["gen_ai.output.messages"] = JSON.stringify([{
				role: "assistant",
				parts: [{
					type: "uri",
					modality: data.resourceType,
					mime_type: output.mimeType,
					uri: output.url
				}],
				finish_reason: finishReason
			}]);
		}
		const span = trace.getTracer("@bfl/sdk", VERSION).startSpan(`generate_content ${data.model}`, {
			kind: SpanKind.CLIENT,
			startTime: new Date(data.startedAt),
			attributes
		});
		if (error) span.setStatus({
			code: SpanStatusCode.ERROR,
			message: error.message
		});
		span.end();
	}
};
function toFinishReason(error) {
	if (!error) return "stop";
	return error.type === "request_moderated" || error.type === "content_moderated" ? "content_filter" : "error";
}
function validAttributes(values) {
	const attributes = {};
	for (const [key, value] of Object.entries(values)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") attributes[key] = value;
	return attributes;
}
//#endregion
//#region src/telemetry/videos.ts
/**
* Telemetry adapter for videos
*/
var VideoTelemetry = class extends JobTelemetry {
	resourceType = "video";
	getSpanAttributes(input) {
		return {
			"black_forest_labs.video.duration": input.duration,
			"black_forest_labs.video.resolution": input.resolution,
			"black_forest_labs.video.aspect_ratio": input.aspectRatio,
			"black_forest_labs.video.audio": input.audio
		};
	}
};
//#endregion
//#region src/bfl.ts
const HOSTS = {
	default: "https://api.bfl.ai",
	eu: "https://api.eu.bfl.ai",
	us: "https://api.us.bfl.ai"
};
/**
* Client for the Black Forest Labs API.
*
* @example
* ```ts
* const bfl = new Bfl() // reads BFL_API_KEY
* const started = await bfl.videos.fromText({ model: 'flux3', prompt: 'A cat surfing a wave' })
* // Save the job as JSON. Later, from any process:
* const job = await bfl.videos.check(started)
* if (job.status === 'ready') console.log(job.media.url)
* ```
*/
var Bfl = class {
	/** Generate videos. */
	videos;
	/**
	* @throws {@link BflError} `missing_api_key` when no API key is passed and `BFL_API_KEY` is not set.
	*/
	constructor(opts = {}) {
		const apiKey = opts.apiKey ?? envApiKey();
		if (!apiKey) throw new BflError("missing_api_key", "No BFL API key. Pass apiKey or set BFL_API_KEY.");
		const host = HOSTS[opts.region ?? "default"];
		const http = new HttpClient({
			apiKey,
			host,
			fetch: opts.fetch ?? globalThis.fetch
		});
		const telemetry = {
			recordContent: opts.telemetry?.recordContent ?? false,
			serverAddress: new URL(host).hostname
		};
		this.videos = new Videos(http);
		this.videos.registerHooks(new VideoTelemetry(telemetry));
	}
};
function envApiKey() {
	const { process } = globalThis;
	try {
		return process?.env.BFL_API_KEY;
	} catch (cause) {
		throw new BflError("missing_api_key", "Deno denied access to BFL_API_KEY. Pass apiKey, or allow env access (--allow-env).", { cause });
	}
}
//#endregion
export { Bfl, BflError };
