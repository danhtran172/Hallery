# Hallery — context handoff

Paste this to an agent picking up work on this repo. Written 18/08/2026, at commit `63fc7f5`.

---

## 1. Sản phẩm là gì

Hallery là **giao diện thay thế cho Notion**, lấy **Gallery view làm trung tâm** (không phải một Notion client đa năng).
Điểm khác biệt duy nhất so với việc mở Notion trực tiếp: người dùng **tự quyết định mỗi property hiển thị ra sao**
và **card được sắp xếp thế nào**, thay vì chịu cách render mặc định của Notion.

Cấu trúc điều hướng: **Card → Card Detail → Edit**.

Ngôn ngữ UI: **tiếng Việt**. Anh/Việt là việc của Phase 8.

---

## 2. Ranh giới kiến trúc — QUAN TRỌNG NHẤT

> **Hallery chỉ đọc dữ liệu Notion và ghi giá trị. Không bao giờ tạo, sửa, hay xoá property / cấu trúc database trong Notion.**

Quy tắc chủ đạo do chủ dự án đặt ra và đã nhấn mạnh nhiều lần. Hệ quả:

| Khái niệm | Nghĩa trong Hallery |
|---|---|
| "Xoá" một item | Ngừng quản lý trong Hallery. Trang Notion gốc **còn nguyên**. |
| Category / Streak / Native button | **Không phải** property mới trong Notion. Là lớp diễn giải đặt trên dữ liệu có sẵn. |
| Đổi tên property | Chỉ đổi tên hiển thị trong Hallery (`displayConfig.nameOverride`). Notion không biết. |
| Sắp xếp nav bar | Chỉ trong Hallery. |
| Cover, layout, display config | Metadata riêng của Hallery, lưu trong SQLite. |

Vì Notion không có chỗ lưu "prop này nên hiển thị thế nào", Hallery vận hành một **shadow schema** song song,
ánh xạ theo `database_id` + `property_id`. Đây là toàn bộ giá trị khác biệt của sản phẩm.

**Ngoại lệ duy nhất đã được chấp thuận:** thêm option mới cho Select/Multi-select — về kỹ thuật là tác dụng phụ
của việc ghi giá trị cho một page, không phải gọi API sửa schema.

---

## 3. Stack và những cái bẫy đã gặp

```
Next.js 16.3.1 (App Router, Turbopack)  ·  React 19.2  ·  TypeScript  ·  Tailwind v4
Prisma 7.9.1 + SQLite qua @prisma/adapter-libsql
@notionhq/client v5.25.2  ·  @dnd-kit/core
```

**Bẫy đã mất thời gian, đừng vấp lại:**

1. **Đây KHÔNG phải Next.js bạn quen.** `AGENTS.md` yêu cầu đọc `node_modules/next/dist/docs/` trước khi viết code.
   Typed routes (`PageProps<"/galleries/[galleryId]">`, `RouteContext<...>`), `params`/`searchParams` là Promise.

2. **Notion SDK v5 dùng model `data_sources`, không phải `database` trực tiếp.**
   Query bằng `notion.dataSources.query({ data_source_id })`. Model `Gallery` lưu cả hai id, unique theo `notionDataSourceId`.

3. **Prisma 7 bắt buộc driver adapter.** Dùng `@prisma/adapter-libsql`, **không** dùng `better-sqlite3`
   (cần Visual Studio Build Tools, cài thất bại trên máy này).

4. **Dev server ôm Prisma client cũ sau mỗi lần migrate.** Triệu chứng: `Cannot read properties of undefined (reading 'findMany')`
   hoặc lỗi import export không tồn tại. → **Restart dev server sau mỗi `prisma migrate`.** `npm run build` vẫn sạch.

5. **URL file Notion là signed URL, hết hạn ~1 giờ** (`expiry_time` có sẵn trong response). Không được cache URL.
   Đã xử lý bằng cách tải bytes về (mục 4.3).

6. **`file.notion.com` chặn hotlink** — ảnh chỉ load trong chính Notion. URL `prod-files-secure.s3...` thì bình thường.
   → Cover vẽ bằng `background-image`, ảnh hỏng thì về nền xám thay vì icon vỡ.

7. **Notion từ chối import chính signed URL của nó.** `fileUploads.create({ mode: "external_url" })` trả
   `validation_error`. Muốn upload phải tự tải bytes rồi `single_part`.

8. **Rate limit Notion ~3 req/s.** Thao tác N+1 theo số item phải cache hoặc tải lười. DB test có **90 item**.

9. **Schema Notion KHÔNG cho biết formula trả ra kiểu gì** — chỉ có `expression`. Kiểu chỉ lộ ra ở giá trị page.

10. **Đừng dùng script Python ghi đè file nguồn.** Một lần crash giữa chừng đã làm rỗng `page.tsx`
    (phải khôi phục từ git). Dùng công cụ Edit/Write.

---

## 4. Hiện trạng

### 4.1 Phase 0 — Nền móng ✅

| Route | Chức năng |
|---|---|
| `/connect` | Dán internal integration token, validate qua `users.me()` |
| `/workspaces/[id]/pick` | Liệt kê data source đã share, thêm làm Gallery |
| `/` | Dashboard workspace → gallery |

Kết nối bằng **paste token thủ công**, chưa phải OAuth.

### 4.2 Phase 1 — Display & Edit ✅

| Route | Chức năng |
|---|---|
| `/galleries/[id]` | Gallery card grid |
| `…/items/[pageId]` | Card Detail + Edit |
| `…/settings/display` | Cấu hình hiển thị từng property + số card mỗi hàng |
| `…/settings/cover` | Nguồn ảnh bìa |

**Display config** (JSON trong `PropertyConfig.displayConfig`):
- Number: `plain` / `rate` (max sao) / `duration` (nhập giờ+phút → lưu tổng phút) / `with_text`
- URL: `link` / `button` (nhãn riêng)
- Date: `full` / `month_only` / `year_only`
- Select / Status / Multi-select: `pill` / `text`, kèm prefix/suffix
- Text: prefix/suffix
- `nameOverride`: đổi tên hiển thị, không đụng Notion

**Edit ghi ngược Notion** qua `pages.update`: title, rich_text, number, url, email, phone, checkbox, date,
select, status, multi_select. Select/Status dùng dropdown; Multi-select dùng chip + dropdown + ô tạo mới.
Field read-only (formula, rollup, created_time…) tự khoá kèm ghi chú.

**Ảnh bìa:**
- Nguồn: ảnh bìa page / prop Files hoặc URL / **ảnh đầu tiên trong nội dung page**
- **Ctrl + kéo** để chỉnh vị trí ảnh, lưu riêng từng page (`CoverPosition`)
- Nguồn "ảnh trong nội dung" tải lười theo IntersectionObserver, **tải bytes về máy** (`.hallery-cache/covers`)
  nên không phụ thuộc signed URL hết hạn; lần sau render thẳng từ server

**Chưa làm:** kiểu hiển thị vuông/dọc/ngang cho prop Files nhiều ảnh; edit cho People / Files / Relation.

### 4.3 Phase 2 — Layout Builder ✅

`…/settings/layout` — builder bố cục **Card Detail**, 2 tầng, kéo-thả bằng dnd-kit, chọn kiểu chia ô và tỉ lệ
từ preview hình. Có template dùng lại giữa các gallery (`LayoutTemplate`), map theo tên property.

### 4.4 Phase 3 — Formula & Category ✅

**Formula/Rollup** được đối xử theo kiểu chúng trả về: formula ra number thì có sao/giờ-phút/affix, ra date thì có
chỉ-tháng/chỉ-năm. Kiểu được dò từ một page mẫu **ngay trong Gallery** (page đã có sẵn → 0 request thêm), lưu vào
`PropertyConfig.resolvedType`. Nếu công thức đổi kiểu, settings cảnh báo cấu hình cũ không còn dùng được.

**Category** — `…/settings/category`. Chọn property làm trục; thanh lọc phía trên Gallery kèm số lượng; trạng thái
nằm trên URL nên share/back được.
- Trục **select / multi_select / status**: 0 API call (giá trị đã có trong data Gallery)
- Trục **relation**: hiện trong settings nhưng **vô hiệu hoá** — chưa làm
- Số đếm chỉ đúng trong phạm vi 100 item đã tải, hiện `7+` khi còn trang

### 4.5 Bố cục card ngoài Gallery ✅ (ngoài roadmap gốc)

`…/settings/card` — màn 5 khung cố định:

1. **Chiều ảnh** — popup Ngang/Dọc/Vuông + tỉ lệ, preview đúng tỉ lệ thật, **bấm OK mới áp dụng**
2. **Layout layer 1** — popup chọn vị trí ảnh, kèm checkbox **Extended width**, cũng cần OK
3. **Danh sách property** — có tìm kiếm, cuộn; **Tiêu đề là một prop kéo được** (in đậm, không bắt buộc hiện)
4. **Canvas card** — kéo prop vào từng ô; checkbox xem bằng dữ liệu thật của item đầu; chừa khoảng trống dưới để dễ thả
5. **Cấu hình prop đang chọn** — hiện/ẩn tên, đổi tên, kiểu hiển thị, affix, có nút Lưu riêng;
   nút ✎ bên phải picker layout đổi khung này sang **Bố cục khung** (số cột × dòng, căn trên/giữa/dưới, tỉ lệ ảnh/chữ)

**Layer 1** (6 bố cục, lọc theo chiều ảnh — ảnh ngang chỉ có 3):
Ảnh trên · Ảnh trái · Ảnh trái + ô dưới · Ảnh phải · Chỉ ảnh · Không ảnh

**Layer 2**: mỗi khung chia lưới tối đa **2 cột × 3 dòng**. Ô do layer 2 tạo ra **không chia tiếp**.

**Loại card & độ rộng cố định** (tự suy từ layout + chiều ảnh):

| Loại | Điều kiện | Width |
|---|---|---|
| Ngang | ảnh trái/phải, hoặc ảnh trên + ảnh ngang, hoặc không ảnh | 100% |
| Extra ngang | như trên + tick Extended width | 120% |
| Dọc | ảnh trên + ảnh dọc/vuông | 60% |

"Số card mỗi hàng" giờ định nghĩa *một card ngang thường rộng bao nhiêu*.

**Gộp ô**: ô trống để trống thì lúc hiển thị **không có khung**; muốn gộp thì chọn Gộp ngang/Gộp dọc; ô bị gộp
thu về dải nhỏ chỉ chứa nút bỏ gộp; kéo prop vào ô đã gộp thì **tự bỏ gộp**.

**Overlay**: tối đa 3 prop đè lên ảnh, trên nền gradient, để xuyên chuột nên click card và Ctrl+kéo vẫn chạy.

### 4.6 Data model

```
Workspace       → accessToken (⚠ plaintext, xem mục 5)
Gallery         → notionDatabaseId, notionDataSourceId, displayConfig(JSON), detailLayout(JSON), parentGallery
PropertyConfig  → notionPropertyId/Name/Type, resolvedType, displayConfig(JSON), sortOrder, hidden, isMissing
CategoryAxis    → notionPropertyId, sourceType, sortOrder
PageImageCache  → notionPageId, imageUrl, expiresAt, storedFile
CoverPosition   → galleryId + notionPageId, posX, posY
LayoutTemplate  → name, layout(JSON)
```

`Gallery.displayConfig` chứa: `coverAspect`, `coverRatio`, `coverSource`, `cardsPerRow`, `card` (bố cục card v4).

---

## 5. Nợ kỹ thuật & rủi ro đã biết

- **Token Notion lưu plaintext trong SQLite.** Phải xử lý trước khi có người dùng ngoài máy dev.
- **Gallery mới lấy 100 item đầu**, chưa phân trang. Số đếm Category vì vậy chỉ đúng trong phạm vi đó.
- **Chưa có polling/webhook** — dữ liệu chỉ refresh khi vào lại trang.
- **Chưa phát hiện xung đột** khi Notion và Hallery sửa cùng field.
- **Chưa cảnh báo tác động** khi đổi display config đang dùng ở nhiều nơi.
- **Thao tác kéo-thả chưa được verify tự động.** dnd-kit bỏ qua synthetic pointer event và môi trường test không
  điều khiển được chuột thật — chỉ state và HTML kết quả được kiểm. Cần người thật thử.
- **S3 của Notion có lúc không truy cập được** từ máy dev (3 lần connect timeout, trong khi api.notion.com bình thường).
  Khi đó không tải được ảnh về, app lùi về dùng URL hết hạn. Cần kiểm lại khi mạng thông.
- Tính năng **sync ảnh vào cover Notion** đã xây rồi **bị gỡ theo yêu cầu** (4 API call/page, 3–5 phút cho 90 item).
  **Đừng dựng lại nếu không được yêu cầu rõ.** Còn sót: page "A Way Out" trong Notion có ảnh bìa do lần thử đó tạo.

---

## 6. Roadmap còn lại

**Phase 4 — Streak & Native button**
Streak tự tính từ **bảng phụ của Hallery** (Notion API không có lịch sử thay đổi property).
Native button = automation nội bộ Hallery, không phải Button property của Notion.

**Phase 5 — Vận hành Gallery**
Filter, Sort, Group, Search, Hide/Order field, Random pick (tôn trọng filter, có công tắc tắt).
Cần query engine có cache + phân trang nhận biết rate limit. Hoàn thiện nốt trục Relation cho Category.

**Phase 6 — Create Form**
Nhập liệu nhanh, chỉ hiện field cần thiết, auto-fill mặc định. Tái dùng UI Layout Builder.

**Phase 7 — Nav bar & workspace**
Multi-gallery, nhóm, sub-gallery (kéo G vào G, giữ 1.5s), thùng rác, tìm kiếm toàn workspace, kéo-thả sắp xếp.

**Phase 8 — Cá nhân hoá & vận hành**
VN/EN, sáng/tối, 5 màu prefix (xanh lá `#4B8B60` mặc định, xanh dương `#0055DA`, teal `#76ABAE`,
hồng `#F5788B`, cam `#F7A00A`), giao diện kính. Cộng: sync status, write queue/retry,
backup dữ liệu Hallery-only, **mã hoá integration token**.

**Phase 9 — Mở rộng (không bắt buộc MVP)**
Multi-user permission, chia sẻ view, thông báo streak/deadline.

---

## 7. Cách làm việc mong đợi

- **Verify trên dữ liệu Notion thật, không chỉ build sạch.** Có database thật "Game Station" 90 item.
  Đọc DB nhanh không cần chạy app:
  ```js
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync("./dev.db");
  db.prepare("SELECT * FROM Gallery").all();
  ```
  Kiểm HTML server trả về khi Browser pane không dùng được:
  ```js
  const html = await (await fetch("http://localhost:3000/galleries/<id>")).text();
  ```
- **Luôn chạy `npm run build` và `npm run lint`** trước khi báo xong.
- **Không tự ý ghi vào Notion thật** ngoài phạm vi được yêu cầu. Cần test ghi thì làm trên 1 page và nói rõ page nào.
- **Commit theo từng tính năng hoàn chỉnh**, message giải thích *tại sao*.
- Chủ dự án trả lời ngắn, hay đổi hướng giữa chừng, và kiểm tra kỹ. **Nếu định bỏ bớt thứ gì họ đã có, phải hỏi
  hoặc báo rõ** — đã có lần tự bỏ 2 layout và bị hỏi lại. Tính năng có điểm yếu (nặng, không hiển thị được,
  phá ranh giới kiến trúc) thì nói thẳng kèm số đo, đừng làm xong mới báo.
