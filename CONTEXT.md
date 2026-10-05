# Hallery — context handoff

Paste this to an agent picking up work on this repo. Written 19/08/2026, at commit `cdd6b62`.

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
| "Không quản lý" một prop | Cờ `PropertyConfig.disabled`. Prop trong Notion nguyên vẹn, Hallery coi như không tồn tại. |
| Sắp xếp nav bar | Chỉ trong Hallery. |
| Cover, layout, display config | Metadata riêng của Hallery, lưu trong SQLite. |

Vì Notion không có chỗ lưu "prop này nên hiển thị thế nào", Hallery vận hành một **shadow schema** song song,
ánh xạ theo `database_id` + `property_id`. Đây là toàn bộ giá trị khác biệt của sản phẩm.

**Hai ngoại lệ đã được chấp thuận, đều là ghi *giá trị* chứ không sửa schema:**
- Thêm option mới cho Select/Multi-select (tác dụng phụ của việc ghi giá trị cho một page).
- **Tạo page mới** qua form (`pages.create` với `parent.data_source_id`) và **upload ảnh** vào page cover /
  prop Files / nội dung page — xem Phase 6.

---

## 3. Stack và những cái bẫy đã gặp

```
Next.js 16.3.1 (App Router, Turbopack)  ·  React 19.2  ·  TypeScript  ·  Tailwind v4
Prisma 7.9.1 + SQLite qua @prisma/adapter-libsql
@notionhq/client v5.25.2  ·  @dnd-kit/core  ·  sharp
```

**Bẫy đã mất thời gian, đừng vấp lại:**

1. **Đây KHÔNG phải Next.js bạn quen.** `AGENTS.md` yêu cầu đọc `node_modules/next/dist/docs/` trước khi viết code.
   Typed routes (`PageProps<"/galleries/[galleryId]">`, `RouteContext<...>`), `params`/`searchParams` là Promise.

2. **Notion SDK v5 dùng model `data_sources`, không phải `database` trực tiếp.**
   Query bằng `notion.dataSources.query({ data_source_id })`. Model `Gallery` lưu cả hai id, unique theo `notionDataSourceId`.

3. **Prisma 7 bắt buộc driver adapter.** Dùng `@prisma/adapter-libsql`, **không** dùng `better-sqlite3`
   (cần Visual Studio Build Tools, cài thất bại trên máy này).

4. **Dev server ôm Prisma client cũ sau mỗi lần migrate.** Triệu chứng: `no such column: …` hoặc
   `Cannot read properties of undefined (reading 'findMany')`. → **Restart dev server sau mỗi `prisma migrate`.**

5. **Turbopack giữ chunk cũ khi thêm component mới.** Triệu chứng lạ hơn nhiều: `tsc` và `npm run build` **sạch**,
   nhưng trên trình duyệt nút bấm không phản hồi, hoặc console báo `X is not defined` với một component vừa viết.
   Gặp **3 lần trong một phiên**. → `rm -rf .next` rồi restart. Đừng đi tìm bug trong code trước khi thử cái này.

6. **`prisma migrate dev` không chạy được ở môi trường non-interactive** khi migration có thao tác mất dữ liệu.
   Đường vòng: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o <file>`
   rồi `prisma migrate deploy`.

7. **URL file Notion là signed URL, hết hạn ~1 giờ.** Không được cache URL. Đã xử lý bằng cách tải bytes về.

8. **`file.notion.com` chặn hotlink** — ảnh chỉ load trong chính Notion. URL `prod-files-secure.s3...` thì bình thường.

9. **Notion từ chối import chính signed URL của nó.** `fileUploads.create({ mode: "external_url" })` trả
   `validation_error`. Muốn upload phải tự tải bytes rồi `single_part`.

10. **Rate limit Notion ~3 req/s.** Thao tác N+1 theo số item phải cache hoặc tải lười. DB test có **90 item**
    (nay 94, xem mục 5).

11. **Schema Notion KHÔNG cho biết formula trả ra kiểu gì** — chỉ có `expression`. Kiểu chỉ lộ ra ở giá trị page.

12. **Property id của Notion có thể đã percent-encode sẵn** — ví dụ `M%5BL%7B`. Đừng `encodeURIComponent` thêm
    lần nữa khi bỏ lên URL: `URLSearchParams` đã lo rồi, decode hai lần thì id không khớp gì cả và **filter
    im lặng trả về rỗng**. Đây là một bug thật đã xảy ra.

13. **`aspect-ratio` thua chiều cao xác định.** Ô ảnh là con của flex sẽ bị `align-items: stretch` kéo cao bằng
    hàng, và khi đó tỉ lệ không còn giữ. → `self-start` cho mọi khung ảnh nằm trong flex row.

14. **Đừng dùng script Python ghi đè file nguồn.** Một lần crash giữa chừng đã làm rỗng `page.tsx`
    (phải khôi phục từ git). Dùng công cụ Edit/Write.

---

## 4. Hiện trạng

Route hiện có — **chỉ còn bấy nhiêu**, `settings/cover` và `settings/layout` đã bị xoá:

```
/                                  Dashboard workspace → gallery
/connect                           Dán internal integration token
/workspaces/[id]/pick              Liệt kê data source đã share, thêm làm Gallery
/galleries/[id]                    Gallery grid + toolbar + form thêm item
/galleries/[id]/items/[pageId]     Card Detail + Edit
/galleries/[id]/settings/card      Bố cục 3 view mode (xem 4.5)
/galleries/[id]/settings/category  Trục phân loại
/galleries/[id]/settings/display   Danh sách prop + cấu hình hiển thị
```

### 4.1 Phase 0 — Nền móng ✅

Kết nối bằng **paste token thủ công**, chưa phải OAuth.

### 4.2 Phase 1 — Display & Edit ✅

**Display config** (JSON trong `PropertyConfig.displayConfig`, và bản riêng cho Card Detail trong
`PropertyConfig.detailDisplayConfig`):
- Number: `plain` / `rate` (max sao) / `duration` (nhập giờ+phút → lưu tổng phút) / `with_text`
- URL: `link` / `button` (nhãn riêng)
- Date: `full` / `month_only` / `year_only`
- Select / Status / Multi-select: `pill` / `text`, kèm prefix/suffix
- Text: prefix/suffix
- `nameOverride`: đổi tên hiển thị, không đụng Notion

**Edit ghi ngược Notion** qua `pages.update`: title, rich_text, number, url, email, phone, checkbox, date,
select, status, multi_select. Field read-only (formula, rollup, created_time…) tự khoá kèm ghi chú.

**Ảnh bìa:** nguồn ảnh chọn trong editor bố cục (`coverSource`): ảnh bìa page / prop Files hoặc URL /
**ảnh đầu tiên trong nội dung page**. **Ctrl + kéo** để chỉnh vị trí, lưu riêng từng page (`CoverPosition`).
Ảnh tải lười theo IntersectionObserver qua `/api/galleries/[id]/cover-preview`, có thumbnail WebP và bản đầy đủ
lưu về `.hallery-cache/covers` nên không phụ thuộc signed URL.

**Chưa làm:** hiển thị/sửa **Relation**, sửa **People** và **Files**, prop Files nhiều ảnh.

### 4.3 Phase 2 — Layout Builder ❌ đã bị thay thế

Builder riêng cho Card Detail (`settings/layout`, `DetailLayout`, `LayoutTemplate`) **đã xoá hoàn toàn**.
Card Detail nay dùng chung định dạng `CardLayout` với gallery card — xem 4.5.

### 4.4 Phase 3 — Formula & Category ✅ (trừ trục Relation)

**Formula/Rollup** được đối xử theo kiểu chúng trả về. Kiểu dò từ một page mẫu ngay trong Gallery
(0 request thêm), lưu vào `PropertyConfig.resolvedType`.

**Category** — `…/settings/category`. Trạng thái nằm trên URL nên share/back được.
- Trục **select / multi_select / status**: 0 API call
- Trục **relation**: vẫn **vô hiệu hoá**, lọc bỏ ở `galleries/[galleryId]/page.tsx`. **Chưa làm** — bị chặn,
  xem mục 5.
- Số đếm nay **chính xác** vì snapshot đã phân trang hết (không còn `7+`).

### 4.5 Bố cục card — một màn, ba view mode ✅

`…/settings/card` có tab **Gallery card · Card Detail · Form thêm**. Cả ba dùng chung định dạng `CardLayout`
và chung editor; giữ cả ba trong state cùng lúc, một nút Lưu commit tất cả.

**Khác nhau giữa ba mode:**

| | Gallery card | Card Detail | Form thêm |
|---|---|---|---|
| Chiều ảnh + vị trí ảnh | ✅ | ✅ riêng | ✅ riêng |
| Độ rộng | `cardsPerRow` | `detailWidth` px (mặc định 880) | popup ~420px |
| Cấu hình prop | display config | `detailDisplayConfig` riêng | bắt buộc + giá trị mặc định |
| Ô "ảnh" | **Lấy ảnh từ** (`coverSource`) | dùng chung nguồn | **Lưu ảnh vào** (`formCoverTarget`) |
| Tray prop | mọi prop đang quản lý | như gallery | **chỉ 11 kiểu ghi được** |

**Chiều ảnh:** Ngang · Dọc · **Đối xứng**. Đối xứng là khung 1:1, bên trong chọn **Vuông** hay **Tròn**
(`coverAspect: "square" | "circle"`). Tròn không phải hướng thứ tư — nó cùng khung, cùng bố cục, chỉ khác lúc vẽ.

**Layer 1** (6 bố cục, ảnh ngang chỉ có 3): Ảnh trên · Ảnh trái · Ảnh trái + ô dưới · Ảnh phải · Chỉ ảnh · Không ảnh.
**Layer 2**: mỗi khung tối đa **2 cột × 3 dòng**, ô layer 2 không chia tiếp.

**Loại card & độ rộng cố định:** Ngang 100% · Extra ngang 120% · Dọc 75%.
"Số card mỗi hàng" định nghĩa *một card ngang thường rộng bao nhiêu*.

**Gộp ô** và **Overlay** (tối đa 3 prop đè lên ảnh) như cũ.

Card Detail chưa custom thì **mượn nguyên bố cục gallery card**, kể cả cover. Có nút **Sync từ gallery card**.

### 4.6 Phase 5 — Vận hành Gallery ✅ (trừ trục Relation)

**Snapshot có phân trang** (`lib/gallery-notion-cache.ts`): đi hết cursor, cache 60s trong `GalleryNotionCache`,
`PAGE_SIZE = 50`, `MAX_PAGES = 50` → **trần 2.500 dòng**, giãn 340ms/request cho khớp rate limit.
Vượt trần thì `has_more` ở lại true và mọi bộ đếm hiểu là "còn nữa".

**Toolbar trên gallery** (`lib/gallery-query.ts` + `components/gallery-toolbar.tsx`) — tất cả chạy **cục bộ**
trên snapshot, không đẩy sang Notion, nên đổi filter không tốn request:
- **Search** quét mọi prop đang quản lý, không chỉ tiêu đề
- **Filter** nhiều điều kiện, toán tử theo kiểu prop
- **Sort** nhiều mức, **kéo tay cầm `⠿` để đổi thứ tự mức**; giá trị trống luôn chìm xuống đáy
- **Group** theo prop, multi-select xuất hiện ở mọi nhóm nó thuộc về
- **Random pick** bốc trong tập đang lọc, tắt được ở Cài đặt hiển thị

Filter/sort đi trên URL dưới dạng **JSON** (không phải chuỗi phân tách — xem bẫy 12).
Mở một item mang theo view qua param `back`, nên bấm quay lại không mất filter.

**Cài đặt hiển thị** đổi thành danh sách prop bên trái + editor bên phải. Mỗi prop có nút
**"Không quản lý nữa"** → `PropertyConfig.disabled`: rời khỏi card, Card Detail, sort, filter **và search**.
Prop bị tắt dồn xuống khung riêng cuối danh sách, vẫn tìm được, bật lại được.

### 4.7 Phase 6 — Create Form ✅

Nút **"+ Thêm item"** cạnh toolbar mở popup, dựng theo `formCard`. `pages.create` với
`parent.data_source_id` — thêm **dòng mới**, không đụng schema.

- **Mặc định mỗi field**: giá trị cố định · **hôm nay** (prop date) · **giữ như lần nhập trước**
  (lưu ở `formLastValues`, cập nhật sau mỗi lần thêm)
- **Bắt buộc**: khái niệm của riêng Hallery (Notion không có), chặn cả ở client lẫn server
- **Ảnh**: kéo thả · dán (Ctrl+V) · bấm chọn file. Trần 20MB (giới hạn single-part của Notion), chặn file
  không phải ảnh. Upload 2 call (`fileUploads.create` + `send`) **trước khi** tạo page, rồi gắn id vào luôn
  lệnh tạo nên không tốn lượt ghi thứ hai.
- **Lưu ảnh vào** (`formCoverTarget`): ảnh bìa page · **nội dung page** (image block) · prop Files.
  Đích "nội dung page" khép vòng với nguồn `content_image` của gallery.

### 4.7b Đại tu 06/10/2026 (`0a24813`, `c5289f4`)

- **Snapshot**: phục vụ bản lưu tới **24 giờ** rồi đồng bộ nền; heartbeat tự `router.refresh()` khi có thay đổi.
  Notion lỗi mà đã có bản lưu → hiện bản lưu + banner; chưa có → màn hướng dẫn sửa (`components/notion-problem`).
  Lỗi được phân loại ở `lib/notion-errors.ts` (token hỏng / chưa share / rate limit / mất mạng).
- **Lưu item chỉ gửi field đã đổi**, ghi theo **property id** (không theo tên). Sửa được tiêu đề; date giữ giờ +
  ngày kết thúc; bỏ tick checkbox được (form có `__fields` manifest).
- **Render prop** (`components/property-value.tsx`): URL thiếu `https://` được bù; link button hiện tên miền; email/
  phone là `mailto:`/`tel:`; rich text giữ link + định dạng; Files mở qua `/api/galleries/[id]/files` (ký lại URL
  hết hạn); Relation hiện tên item và mở item trong Hallery nếu bảng đích là gallery (đã kiểm với relation tự trỏ
  "Chapters Data"), không thì link sang Notion.
- **Native button** (Phase 4, phần button): gán hành động cho prop Button của Notion ở Cài đặt hiển thị — chỉ ghi
  giá trị (set/clear, hôm nay/bây giờ, cộng số, tick, thêm/bỏ option). Lưu ở `displayConfig.button`.
  ⚠ Đường ghi của nút **chưa chạy thử trên Notion thật** (chỉ "Hentai Gallery" có prop Button, là dữ liệu thật).
- **Kết nối**: trang `/connect` hướng dẫn từng bước + link tạo integration; dán lại cùng integration không tạo
  workspace trùng (khớp bot id / token); `/connect?workspace=<id>` kết nối lại; trang chọn database phân trang +
  tìm kiếm; trang chủ có Kết nối lại / Gỡ workspace (chỉ phía Hallery).
- **UI**: design tokens trong `globals.css` (`bg-brand`, `text-ink`, `border-line`, `.btn`, `.input`, `.panel`…),
  font Inter (có subset tiếng Việt), bỏ dark mode hỏng, grid card co cột theo container query, sidebar dính +
  drawer trên điện thoại, settings dùng chung `SettingsHeader` và giữ `?view=`.

### 4.7c Giao diện mới + rà soát flow 06/10/2026 (`e5bd425`, `0bf1c23`)

- **Giao diện**: canvas giấy pha màu nhấn, nội dung nằm trên một "sheet" bo tròn; nút pill, tab dạng segmented,
  card giữ ảnh bìa như ảnh trong khung (`.g-mat`/`.g-pic`). Font **Be Vietnam Pro** (chữ) + **Bricolage Grotesque**
  (tiêu đề, class `.display`). Icon SVG chung ở `components/icons.tsx` (+ logo `LogoMark`).
- **Sáng/tối/theo máy + 5 màu nhấn** (Phase 8, phần giao diện): mọi token là cặp `light-dark()` trong `globals.css`;
  lựa chọn lưu ở cookie `hallery-theme`/`hallery-accent`, layout đọc cookie nên không nháy. Chỉnh ở chân sidebar.
  Màu palette Tailwind (chip màu Notion, editor) được đảo trong `:root` để tự tối theo.
- **Tính năng thêm**: Ctrl+K tìm gallery + item toàn bộ (`lib/global-search.ts`, `/api/search`, chỉ đọc snapshot);
  ‹ › / phím mũi tên chuyển item trong popup (đọc thứ tự từ grid phía sau, không tốn payload); pill trạng thái
  đồng bộ = nút "đồng bộ ngay"; đổi tên gallery (bấm đúp tiêu đề / menu); dời view trái/phải; xoá hẳn khỏi thùng
  rác / dọn sạch; dashboard có ảnh ghép bìa + số item + lần đồng bộ.
- **Flow đã sửa**: "+ Thêm gallery" vào thẳng trang chọn database; settings giữ cả trạng thái gallery qua `?back=`;
  **bỏ nút "Xoá hết"** (nó xoá luôn bộ lọc đã lưu của view khi chỉ đang tìm kiếm); form không mất chữ khi server
  báo lỗi (submit thủ công, tránh React reset form); đóng popup / chuyển item khi đang sửa dở thì hỏi
  (`lib/unsaved-guard.ts`); editor bố cục cảnh báo khi rời trang chưa lưu và báo "Đã lưu"; sau khi thêm item có
  link "Mở item"; detail dùng nguồn ảnh bìa của view đang mở; gallery trong thùng rác có màn khôi phục; kết nối lại
  token quay về đúng trang đang lỗi (`?return=`).
- **Exception**: action tạo/lưu/nút coi mọi bước sau khi Notion đã ghi là phụ (không báo lỗi giả → không tạo
  trùng); upload ảnh tới 21 MB (`next.config.ts`); `error.tsx` riêng cho gallery và popup item + `global-error.tsx`;
  property mới đăng ký bằng upsert; cover lookup lỗi trả 503 để card hiện "Thử lại".
- **Đã bỏ**: ô lọc gallery trong sidebar (Ctrl+K thay), gợi ý "Giữ Ctrl rồi kéo" hiện trên mọi ảnh khi hover
  (giờ chỉ hiện khi đang giữ Ctrl).

### 4.8 Data model

```
Workspace          → accessToken (⚠ plaintext, xem mục 5)
Gallery            → notionDatabaseId, notionDataSourceId, displayConfig(JSON), autoAdded, parentGallery
GalleryNotionCache → dataSourceJson, queryJson, freshUntil/staleUntil (tươi 60s, phục vụ cũ tới 24h)
PropertyConfig     → notionPropertyId/Name/Type, resolvedType, displayConfig(JSON),
                     detailDisplayConfig(JSON), sortOrder, disabled, isMissing
CategoryAxis       → notionPropertyId, sourceType, sortOrder
PageImageCache     → notionPageId, imageUrl, expiresAt, storedFile, thumbnailFile, thumbnailSource
CoverPosition      → galleryId + notionPageId, posX, posY
```

`Gallery.displayConfig` chứa: `coverAspect`, `coverRatio`, `coverSource`, `cardsPerRow`, `randomPick`,
`card`, `detailCard`, `detailWidth`, `detailCoverAspect/Ratio`,
`formCard`, `formDefaults`, `formLastValues`, `formCoverTarget`, `formCoverAspect/Ratio`.

**Đã xoá:** `Gallery.detailLayout`, model `LayoutTemplate`, `PropertyConfig.hidden` (đổi tên thành `disabled`).

---

## 5. Nợ kỹ thuật & rủi ro đã biết

- **Token Notion lưu plaintext trong SQLite.** Phải xử lý trước khi có người dùng ngoài máy dev.
- **Trần crawl 2.500 dòng** (`MAX_PAGES × PAGE_SIZE`). DB lớn hơn sẽ bị cắt, `has_more` ở lại true.
  Nâng `MAX_PAGES` lên 100 là lấy lại mức 5.000 — **đang chờ chủ dự án quyết**.
- **Relation**: nay đã có DB thật có relation — "Hentai Gallery" (workspace "Vynne's Space") với "Chapters Data"
  tự trỏ về chính nó; hiển thị relation đã kiểm trên dữ liệu đó. Trục Relation cho Category vẫn chưa làm.
  Streak (Phase 4) vẫn tạm dừng.
- **HalleryTest** (workspace "Second Brain") hiện **không còn được share** với integration — mở gallery ra màn
  "Database chưa được chia sẻ". Không phải bug.
- **3 workspace "Second Brain" trùng** (cùng token, cùng bot id) — chủ dự án chọn **giữ nguyên** (06/10/2026);
  chỉ sửa để không phát sinh thêm. Gỡ được từ trang chủ nếu muốn.
- **Chưa có polling/webhook** — dữ liệu chỉ refresh khi cache 60s hết hạn hoặc sau khi Hallery ghi.
- **Chưa phát hiện xung đột** khi Notion và Hallery sửa cùng field.
- **Kéo-thả chưa verify tự động được.** dnd-kit bỏ qua synthetic pointer event. Logic sắp xếp thì tách ra
  hàm thuần (`moveItem`) và test được; còn động tác kéo cần người thật thử.
- **IntersectionObserver không chạy khi document bị ẩn.** Trong môi trường agent, Browser pane không composite
  (`visibilityState: "hidden"`, `requestAnimationFrame` không fire) nên **ảnh card không bao giờ tải**.
  Đây là giới hạn môi trường, **không phải bug app** — đừng đi sửa.
- **S3 của Notion có lúc không truy cập được** từ máy dev. Khi đó không tải được ảnh về.
- Tính năng **sync ảnh vào cover Notion hàng loạt** đã xây rồi **bị gỡ theo yêu cầu** (4 API call/page,
  3–5 phút cho 90 item). **Đừng dựng lại nếu không được yêu cầu rõ.** Lưu ý phân biệt: upload ảnh trong
  form Phase 6 là chuyện khác — 2 call cho **một** item, đúng lúc người dùng chủ động thêm.
- **4 page test còn trong Notion thật** do phiên 19/08 tạo, DB từ 90 lên 94 item:
  `ZZZ Hallery test item`, `ZZZ Hallery test anh`, `ZZZ Hallery test content`, và một page **không tiêu đề**
  (`3c1ece5c-cb10-817c-935a-e1b12208d14b`) lọt vào do bug đã sửa. Chờ chủ dự án cho phép archive.
- **Cấu hình gallery "Game Station" đang ở trạng thái test**, không phải lựa chọn của chủ dự án:
  cover tròn, bố cục ảnh-trái/phải, layout form do agent ghi thẳng vào DB.

---

## 6. Roadmap còn lại

**Phase 4 — Streak & Native button** ⏸ tạm dừng
Spec đã chốt lại và **khác CONTEXT cũ**: streak tính trên **bảng được relation tới** (bảng đó chính là lịch sử),
không cần bảng phụ. Đếm theo **ngày liên tiếp**, thiếu ngày là đứt; hiện **cả chuỗi hiện tại lẫn kỷ lục**;
mốc màu do người dùng nhập.
**Button property của Notion là ngõ cụt** — API trả `button: EmptyObject`, không đọc được hành động, không có
endpoint kích hoạt. Chủ dự án chọn làm **native button** của Hallery (chỉ ghi giá trị).

**Phase 5** ✅ trừ trục Relation cho Category.

**Phase 6** ✅.

**Phase 7 — Nav bar & workspace** — phần lớn ✅ (tìm kiếm toàn workspace = Ctrl+K, thùng rác có xoá hẳn, đổi tên)
Multi-gallery, nhóm, sub-gallery, thùng rác, tìm kiếm toàn workspace, kéo-thả sắp xếp.
Một phần đã làm trước ở `92a5372`: thêm gallery thì tự kéo theo bảng trong relation, 2 cấp, ẩn khỏi dashboard
(`Gallery.autoAdded`), vào qua popup "Bảng liên kết". **Chưa verify.**

**Phase 8 — Cá nhân hoá & vận hành** — sáng/tối, 5 màu nhấn và sync status ✅ (`0bf1c23`); còn lại VN/EN,
giao diện kính, write queue/retry, backup, mã hoá token.
VN/EN, sáng/tối, 5 màu prefix (xanh lá `#4B8B60` mặc định, xanh dương `#0055DA`, teal `#76ABAE`,
hồng `#F5788B`, cam `#F7A00A`), giao diện kính. Cộng: sync status, write queue/retry,
backup dữ liệu Hallery-only, **mã hoá integration token**.

**Phase 9 — Mở rộng (không bắt buộc MVP)**
Multi-user permission, chia sẻ view, thông báo streak/deadline.

---

## 7. Cách làm việc mong đợi

- **Verify trên dữ liệu Notion thật, không chỉ build sạch.** Có database thật "Game Station".
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
- **Cẩn thận với phép thử của chính mình.** Đã có ba lần đo sai liên tiếp rồi suýt báo nhầm là bug:
  tìm chuỗi hiển thị (`4/5`) thay vì giá trị thô, và tưởng một giá trị chỉ nằm ở một prop trong khi nó nằm ở bốn.
  Soi thẳng vào snapshot trước khi kết luận code sai.
- **Luôn chạy `npm run build` và `npm run lint`** trước khi báo xong.
- **Không tự ý ghi vào Notion thật** ngoài phạm vi được yêu cầu. Cần test ghi thì làm trên 1 page, nói rõ page
  nào, và **hỏi trước khi xoá**. Notion API chỉ archive được chứ không xoá vĩnh viễn.
- **Commit theo từng tính năng hoàn chỉnh**, message giải thích *tại sao*.
- Chủ dự án trả lời ngắn, hay đổi hướng giữa chừng, và kiểm tra kỹ. **Nếu định bỏ bớt thứ gì họ đã có, phải hỏi
  hoặc báo rõ.** Tính năng có điểm yếu (nặng, không hiển thị được, phá ranh giới kiến trúc) thì nói thẳng kèm
  số đo, đừng làm xong mới báo.
- **Hỏi khi mô tả có hai cách hiểu.** Phiên 19/08 đoán sai ba lần (bỏ ảnh bìa ở Card Detail, hình tròn là hướng
  thứ tư, "bỏ phần ảnh bìa" là bỏ màn nào) — mỗi lần đều phải làm lại. Một câu hỏi rẻ hơn một lần dựng lại.
