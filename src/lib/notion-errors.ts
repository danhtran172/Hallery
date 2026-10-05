import { APIErrorCode, ClientErrorCode, isNotionClientError } from "@notionhq/client";

/**
 * Why a Notion request failed, reduced to what the reader can act on. The raw error can carry
 * request details, so only this classification ever leaves the server.
 */
export type NotionProblem =
  /** The token was revoked, regenerated or mistyped. Fix: paste a new token. */
  | "unauthorized"
  /** The database (or page) is no longer shared with the integration, or was deleted. */
  | "not_shared"
  /** Notion's ~3 req/s budget ran out. Fix: wait a moment. */
  | "rate_limited"
  /** Notion or the network is down. Fix: try again later. */
  | "unavailable";

export function classifyNotionError(error: unknown): NotionProblem {
  if (isNotionClientError(error)) {
    switch (error.code) {
      case APIErrorCode.Unauthorized:
        return "unauthorized";
      case APIErrorCode.ObjectNotFound:
      case APIErrorCode.RestrictedResource:
        return "not_shared";
      case APIErrorCode.RateLimited:
        return "rate_limited";
      case ClientErrorCode.RequestTimeout:
      default:
        return "unavailable";
    }
  }
  return "unavailable";
}

/** Thrown when a Gallery has no usable snapshot and Notion refused to provide one. */
export class NotionAccessError extends Error {
  readonly problem: NotionProblem;

  constructor(problem: NotionProblem) {
    super(`Notion access failed: ${problem}`);
    this.name = "NotionAccessError";
    this.problem = problem;
  }
}

export function isNotionAccessError(error: unknown): error is NotionAccessError {
  return error instanceof NotionAccessError;
}

export const NOTION_PROBLEM_COPY: Record<NotionProblem, { title: string; body: string }> = {
  unauthorized: {
    title: "Token Notion không còn hợp lệ",
    body: "Integration token đã bị thu hồi, tạo lại hoặc nhập sai. Kết nối lại bằng token mới — cấu hình Hallery của bạn vẫn giữ nguyên.",
  },
  not_shared: {
    title: "Database chưa được chia sẻ với integration",
    body: "Notion không cho integration đọc database này nữa — thường do database bị gỡ khỏi Connections, bị chuyển chỗ hoặc bị xoá. Mở database trong Notion → ••• → Connections → thêm lại integration, rồi tải lại trang.",
  },
  rate_limited: {
    title: "Notion đang giới hạn tốc độ",
    body: "Hallery gửi quá nhiều request trong thời gian ngắn. Đợi vài giây rồi thử lại.",
  },
  unavailable: {
    title: "Không kết nối được tới Notion",
    body: "Notion hoặc mạng đang có sự cố. Thử lại sau ít phút.",
  },
};
