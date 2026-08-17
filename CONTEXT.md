# Hallery — context handoff

Paste this to an agent picking up work on this repo. Written 17/08/2026, at commit `635ed72`.

---

## 1. Sản phẩm là gì

Hallery là **giao diện thay thế cho Notion**, lấy **Gallery view làm trung tâm** (không phải một Notion client đa năng).
Điểm khác biệt duy nhất so với việc mở Notion trực tiếp: người dùng **tự quyết định mỗi property hiển thị ra sao**,
thay vì chịu cách render mặc định của Notion.

Cấu trúc điều hướng: **Card → Card Detail → Edit**.

Ví dụ những gì "tuỳ chỉnh hiển thị" nghĩa là:
- Number → sao đánh giá, giờ:phút, hoặc kèm chữ trước/sau
- URL → nút bấm có nhãn riêng
- Select/Multi-select → pill màu hoặc chữ thường, kèm prefix/suffix
- Date → đầy đủ / chỉ tháng / chỉ năm

Ngôn ngữ UI: **tiếng Việt**. Có kế hoạch thêm Anh/Việt ở Phase 8.

---

## 2. Ranh giới kiến trúc — QUAN TRỌNG NHẤT

> **Hallery chỉ đọc dữ liệu Notion và ghi giá trị. Không bao giờ tạo, sửa, hay xoá property / cấu trúc database trong Notion.**

Đây là quy tắc chủ đạo do chủ dự án đặt ra và đã được nhấn mạnh nhiều lần. Hệ quả:

| Khái niệm | Nghĩa trong Hallery |
|---|---|
| "Xoá" một item | Ngừng quản lý trong Hallery. Trang Notion gốc **còn nguyên**. |
| Category / Streak / Native button | **Không phải** property mới trong Notion. Là lớp diễn giải của Hallery đặt trên dữ liệu có sẵn. |
| Sắp xếp thứ tự nav bar | Chỉ trong Hallery. Không phản ánh ngược sidebar Notion. |
| Cover, layout, display config | Metadata riêng của Hallery, lưu trong SQLite. |

Vì Notion không có chỗ lưu "prop này nên hiển thị thế nào", Hallery vận hành một **shadow schema** song song,
ánh xạ theo `database_id` + `property_id`. Đây là toàn bộ giá trị khác biệt của sản phẩm —
mất phần này thì Hallery không còn lý do tồn tại, dù dữ liệu Notion vẫn nguyên vẹn.

**Ngoại lệ duy nhất đã được chấp thuận:** thêm option mới cho Select/Multi-select. Về kỹ thuật đây là tác dụng phụ
của việc ghi giá trị cho một page (Notion tự tạo option), không phải gọi API sửa schema — nên vẫn nằm trong ranh giới.

---

## 3. Stack và những cái bẫy đã gặp

```
Next.js 16.3.1 (App Router, Turbopack)  ·  React 19.2  ·  TypeScript  ·  Tailwind v4
Prisma 7.9.1 + SQLite qua @prisma/adapter-libsql
@notionhq/client v5.25.2
```

**Bẫy đã mất thời gian, đừng vấp lại:**

1. **Đây KHÔNG phải Next.js bạn quen.** `AGENTS.md` yêu cầu đọc `node_modules/next/dist/docs/` trước khi viết code.
   Ví dụ khác biệt: typed routes (`PageProps<"/galleries/[galleryId]">`, `RouteContext<...>`), `params` là Promise.

2. **Notion SDK v5 dùng model `data_sources`, không phải `database` trực tiếp.**
   Query bằng `notion.dataSources.query({ data_source_id })`, không phải `databases.query`.
   Một database có nhiều data source; `DatabaseObjectResponse.data_sources[]` liệt kê chúng.
   Model `Gallery` lưu **cả hai** id và unique theo `notionDataSourceId`.

3. **Prisma 7 bắt buộc driver adapter.** `new PrismaClient()` trống sẽ lỗi.
   Đã dùng `@prisma/adapter-libsql` chứ **không** dùng `better-sqlite3` — package đó cần Visual Studio Build Tools
   để compile native trên máy này và cài thất bại.

4. **Dev server ôm Prisma client cũ sau mỗi lần migrate.** Triệu chứng:
   `TypeError: Cannot read properties of undefined (reading 'findMany')`, hoặc lỗi import export không tồn tại.
   → **Restart dev server sau mỗi `prisma migrate`.** Không phải bug code; `npm run build` vẫn sạch.

5. **URL file của Notion là signed URL và hết hạn (~1 giờ).** Response có sẵn field `expiry_time`.
   Không được lưu URL vào DB rồi dùng mãi.

6. **`file.notion.com` chặn hotlink** — ảnh chỉ load được trong chính Notion, bên thứ ba nhận CORS/403.
   Trong khi URL `prod-files-secure.s3.amazonaws.com` thì load bình thường.
   → Cover vẽ bằng `background-image` chứ không phải `<img>`, để ảnh hỏng thì về nền xám thay vì icon ảnh vỡ.

7. **Notion từ chối import chính signed URL của nó.** `fileUploads.create({ mode: "external_url" })` trả
   `validation_error: "Failed to fetch the headers of the external URL"`. Muốn upload phải tự tải bytes rồi
   `mode: "single_part"` + `fileUploads.send()`.

8. **Rate limit Notion ~3 req/s.** Bất cứ thao tác nào N+1 theo số item đều phải cache hoặc tải lười.
   Gallery thật đang test có **90 item**.

---

## 4. Hiện trạng — đã build được gì

### Phase 0 — Nền móng ✅

| Route | Chức năng |
|---|---|
| `/connect` | Dán internal integration token, validate qua `users.me()` |
| `/workspaces/[id]/pick` | Liệt kê data source đã share với integration, thêm làm Gallery |
| `/` | Dashboard liệt kê workspace → gallery |

Kết nối bằng **paste token thủ công**, chưa phải OAuth đầy đủ (đơn giản hoá cho MVP).

### Phase 1 — Display & Edit ✅ (phần lõi)

| Route | Chức năng |
|---|---|
| `/galleries/[id]` | Gallery card grid, có ảnh bìa |
| `/galleries/[id]/items/[pageId]` | Card Detail + Edit mode |
| `/galleries/[id]/settings/display` | Cấu hình hiển thị từng property |
| `/galleries/[id]/settings/cover` | Nguồn ảnh bìa + định dạng/tỉ lệ khung |

**Display config đã có** (lưu JSON trong `PropertyConfig.displayConfig`):
- Number: `plain` / `rate` (sao, `max` tuỳ chỉnh) / `duration` (nhập giờ+phút → lưu tổng phút) / `with_text` (prefix/suffix)
- URL: `link` / `button` (nhãn tuỳ chỉnh)
- Date: `full` / `month_only` / `year_only`
- Select / Status / Multi-select: `pill` / `text`, kèm prefix/suffix

**Edit ghi ngược Notion** qua `pages.update` cho: title, rich_text, number, url, email, phone, checkbox, date,
select, status, multi_select. Select/Status dùng dropdown thật; Multi-select dùng chip có nút xoá + dropdown +
ô gõ tên mới. Field read-only (formula, rollup, created_time, ...) tự khoá kèm ghi chú.

**Ảnh bìa card:**
- Nguồn chọn được: ảnh bìa page / prop Files hoặc URL / **ảnh đầu tiên trong nội dung page**
- Khung: Ngang (16:9, 3:2, 4:3, 2:1, 21:9) / Dọc (2:3, 3:4, 4:5, 9:16, 1:2) / Vuông / Tắt — chọn 2 bước, có preview ảnh thật
- **Ctrl + kéo để chỉnh vị trí ảnh**, lưu riêng từng page
- Nguồn "ảnh trong nội dung" tốn 1 API call/page → tải lười theo IntersectionObserver, cache vào
  `PageImageCache`, lần sau render thẳng từ server

### Chưa làm trong Phase 1
- **Images property**: chọn kiểu hiển thị vuông/dọc/ngang cho prop Files nhiều ảnh
- Edit cho People / Files / Relation (đang hiện read-only kèm ghi chú "chưa hỗ trợ")

### Data model hiện tại (`prisma/schema.prisma`)

```
Workspace       → accessToken (⚠ đang lưu plaintext, xem mục 6)
Gallery         → notionDatabaseId, notionDataSourceId, displayConfig(JSON), parentGallery (self-relation)
PropertyConfig  → notionPropertyId/Name/Type, displayConfig(JSON), sortOrder, hidden
PageImageCache  → notionPageId, imageUrl, expiresAt
CoverPosition   → galleryId + notionPageId, posX, posY
```

`Gallery.parentGalleryId` và `PropertyConfig.sortOrder`/`hidden` đã có sẵn trong schema nhưng **chưa có UI dùng đến**.

---

## 5. Roadmap còn lại

Thứ tự dưới đây là thứ tự **phụ thuộc thật**, đảo là phải làm lại.

**Phase 2 — Layout Builder 2 lớp**
Kéo-thả layout tổng (2 cột / 1 cột / 2-1 trên-dưới), lồng layout con vào từng ô, kéo prop vào ô.
Lưu JSON có version hoá để nhân bản thành template.

**Phase 3 — Formula & Category**
Formula tự nhận kiểu hiển thị theo output cuối (formula ra number thì quản như number).
Category = **chỉ đọc Rollup có sẵn**, không tự truy vết Relation (tránh N+1). Field chưa có Rollup thì hướng dẫn
người dùng tự tạo trong Notion — Hallery không tạo hộ.

**Phase 4 — Streak & Native button**
Streak tự tính từ **bảng phụ của Hallery** (Notion API không có lịch sử thay đổi property, không suy ngược được).
Native button = automation nội bộ Hallery, không phải Button property của Notion.

**Phase 5 — Vận hành Gallery**
Filter, Sort, Group, Search, Hide/Order field, tab Category, Random pick (tôn trọng filter hiện tại, có công tắc tắt).
Cần query engine có cache + phân trang nhận biết rate limit.

**Phase 6 — Create Form**
Nhập liệu nhanh, chỉ hiện field cần thiết, auto-fill mặc định. Tái dùng UI Layout Builder.

**Phase 7 — Nav bar & workspace**
Multi-gallery, nhóm, sub-gallery (kéo G này vào G kia, giữ 1.5s), thùng rác, tìm kiếm toàn workspace, kéo-thả sắp xếp.

**Phase 8 — Cá nhân hoá & vận hành**
VN/EN, sáng/tối, 5 màu prefix (xanh lá `#4B8B60` mặc định, xanh dương `#0055DA`, teal `#76ABAE`, hồng `#F5788B`,
cam `#F7A00A`), giao diện kính. Cộng: sync status, write queue/retry, backup dữ liệu Hallery-only,
**mã hoá integration token**.

**Phase 9 — Mở rộng (không bắt buộc MVP)**
Multi-user permission, chia sẻ view, thông báo streak/deadline.

---

## 6. Nợ kỹ thuật & rủi ro đã biết

- **Token Notion đang lưu plaintext trong SQLite.** Chấp nhận được cho MVP chạy local, phải xử lý trước khi có
  người dùng thật ngoài máy dev.
- **Gallery mới lấy 100 item đầu**, chưa phân trang.
- **Chưa có polling/webhook** — dữ liệu chỉ refresh khi vào lại trang. Notion không có realtime thật cho bên thứ ba;
  định vị đúng là "gần thời gian thực" + nút làm mới + mốc "đồng bộ lúc…".
- **Chưa có phát hiện xung đột** khi Notion và Hallery sửa cùng field.
- **Chưa hoà giải khi property đổi type/bị xoá** trong Notion sau khi Hallery đã gắn display config vào ID đó.
- **Chưa cảnh báo tác động** cho các thao tác ảnh hưởng nhiều nơi (đổi display config đang dùng ở nhiều layout,
  xoá option Select đang được N item dùng).
- Trang **"Ảnh bìa"** hiện chỉ có phần cấu hình; một tính năng sync ảnh vào cover Notion đã được xây rồi **bị gỡ bỏ
  theo yêu cầu** (quá nặng: 4 API call/page, ~3–5 phút cho 90 item). Đừng dựng lại nếu không được yêu cầu rõ.
  Còn sót: page "A Way Out" trong Notion có ảnh bìa do lần thử nghiệm đó tạo ra.

---

## 7. Cách làm việc mong đợi

- **Verify trên dữ liệu Notion thật, không chỉ build sạch.** Có sẵn database thật "Game Station" 90 item để test.
  Cách đọc DB nhanh không cần chạy app:
  ```js
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync("./dev.db");
  db.prepare("SELECT * FROM Gallery").all();
  ```
- **Luôn chạy `npm run build` và `npm run lint`** trước khi báo xong. Build bắt lỗi type mà dev server bỏ qua.
- **Không tự ý ghi vào Notion thật** ngoài phạm vi tính năng được yêu cầu. Nếu cần test ghi, làm trên 1 page và
  nói rõ page nào.
- **Commit theo từng tính năng hoàn chỉnh**, message giải thích *tại sao* chứ không liệt kê file.
- Chủ dự án trả lời ngắn, hay đổi hướng giữa chừng, và **kiểm tra kỹ** — nếu một tính năng có điểm yếu
  (nặng, không hiển thị được, phá ranh giới kiến trúc) thì nói thẳng kèm số đo, đừng làm xong rồi mới báo.
