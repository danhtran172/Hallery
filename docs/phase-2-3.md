# Phase 2 & 3 — Yêu cầu chi tiết

Viết 17/08/2026, tại commit `fb71fbc`. Đọc kèm [CONTEXT.md](../CONTEXT.md) — đặc biệt mục ranh giới kiến trúc:
**Hallery chỉ đọc dữ liệu Notion và ghi giá trị, không đụng schema/property.**

---

# PHASE 2 — Layout Builder 2 lớp

## 2.0 Mục tiêu

Cho phép người dùng tự dựng bố cục màn hình Card Detail bằng kéo-thả, thay vì danh sách property xếp dọc cứng nhắc
như hiện tại. Đây là tính năng **định nghĩa sản phẩm** — thứ Notion không cho làm.

Trích yêu cầu gốc:
> Lớp 1: layout tổng thể, 2 cột, 1 cột, 2 cột - 1 cột chia trên dưới (trái/phải)
> Lớp 2: tương tự, nhưng sẽ để vào từng ô của layout 1 → tạo ra layout 2 lớp siêu custom
> Lớp 3 sẽ là các prop, kéo từ cột bên trái, nút cài đặt để edit kiểu hiển thị

## 2.1 Mô hình layout

Layout là một **cây tối đa 2 tầng chia ô**, tầng thứ ba là property.

```
Root (tầng 1)  →  Region (tầng 2, tuỳ chọn)  →  Slot chứa property (tầng 3)
```

**Kiểu chia ô** (dùng chung cho cả tầng 1 và tầng 2):

| Kiểu | Mô tả |
|---|---|
| `single` | 1 ô, chiếm toàn bộ |
| `two-col` | 2 cột cạnh nhau |
| `two-col-split-left` | 2 cột, **cột trái** chia tiếp trên/dưới → 3 ô |
| `two-col-split-right` | 2 cột, **cột phải** chia tiếp trên/dưới → 3 ô |
| `stack` | 2 hàng trên/dưới |

**Ràng buộc:** độ sâu tối đa 2. Một ô ở tầng 2 **không được** chia tiếp — nó chỉ chứa property.
Editor phải chặn thao tác này chứ không để người dùng tạo rồi mới báo lỗi.

**Tỉ lệ cột:** mỗi kiểu chia 2 cột cho chỉnh tỉ lệ, chọn từ danh sách cố định (50/50, 60/40, 40/60, 70/30, 30/70).
Không làm kéo thanh chia tự do ở phase này — nhiều công, ít giá trị.

## 2.2 Data model

Thêm cột vào `Gallery` (không tạo bảng mới — mỗi gallery có đúng một layout Card Detail):

```prisma
model Gallery {
  // ...
  detailLayout String @default("")   // JSON, rỗng = dùng layout mặc định
}
```

Cấu trúc JSON, **có version** để về sau đổi mà không vỡ dữ liệu cũ:

```jsonc
{
  "version": 1,
  "root": {
    "kind": "two-col-split-right",
    "ratio": [60, 40],
    "cells": [
      { "id": "c1", "props": ["title", "%3Ah%5EL"] },
      { "id": "c2", "props": ["notion_prop_id_x"] },
      { "id": "c3", "props": [] }
    ]
  }
}
```

- `props` chứa **`notionPropertyId`**, không phải tên property. Tên đổi trong Notion thì layout vẫn nguyên.
- Số phần tử `cells` do `kind` quyết định (`single`=1, `two-col`/`stack`=2, `two-col-split-*`=3).
- Ô có thể chứa một layout con: `{ "id": "c1", "kind": "stack", "cells": [...] }` — đây là tầng 2.

**Layout mặc định** khi `detailLayout` rỗng: `single`, chứa toàn bộ property theo `PropertyConfig.sortOrder`.
Nghĩa là hành vi hiện tại vẫn giữ nguyên cho gallery chưa cấu hình gì — không có migration bắt buộc.

## 2.3 Màn hình Layout Builder

Route mới: `/galleries/[galleryId]/settings/layout`

Bố cục 3 phần:

```
┌──────────────┬────────────────────────────────────┐
│ PROPERTY     │  CANVAS                            │
│ (chưa dùng)  │  ┌──────────────┬───────────────┐  │
│              │  │              │   [Prop] ⚙ ✕  │  │
│ ⠿ Genre      │  │  [Prop]  ⚙ ✕ ├───────────────┤  │
│ ⠿ Publisher  │  │              │   thả vào đây │  │
│ ⠿ Score      │  └──────────────┴───────────────┘  │
│              │                                    │
│              │  [Đổi kiểu chia ô ▾] [Tỉ lệ ▾]     │
└──────────────┴────────────────────────────────────┘
```

**Cột trái — kho property:**
- Liệt kê property **chưa được đặt** vào layout nào.
- Kéo được. Có ô tìm kiếm khi database nhiều property (DB thật đang test có ~22 property).
- Hiển thị badge kiểu dữ liệu (`select`, `number`, `formula`…) để dễ nhận.

**Canvas:**
- Vẽ đúng cấu trúc layout thật, tỉ lệ thật — nhìn là ra hình dung màn Detail.
- Mỗi ô là một vùng thả. Ô rỗng hiện gợi ý "Thả property vào đây".
- Property đã đặt hiển thị dưới dạng thẻ, kéo được để đổi vị trí (trong ô hoặc sang ô khác).
- Mỗi thẻ có 2 nút: **⚙ cài đặt hiển thị** và **✕ gỡ khỏi layout** (gỡ thì quay lại kho bên trái).
- Mỗi ô có nút chia nhỏ (chỉ hiện ở ô tầng 1 chưa chia, và bị vô hiệu hoá ở tầng 2).

**Nút ⚙ mở panel cấu hình hiển thị của property đó**, tái dùng đúng logic đang có ở
`/settings/display` — không viết lại lần hai. Việc này nên **tách `/settings/display` thành component dùng chung**
trước khi làm builder.

## 2.4 Detail và Edit dùng chung một layout

Đây là quyết định thiết kế cần chốt rõ: **màn Edit không phải form riêng.** Nó dùng đúng layout của màn Detail,
chỉ thay giá trị bằng ô nhập tại chỗ.

Lý do: yêu cầu gốc ghi *"Phần edit hiển thị cơ bản gần giống notion"* — Notion sửa tại chỗ, không nhảy sang form khác.
Và nếu Edit có bố cục riêng thì người dùng phải cấu hình layout hai lần.

Hệ quả kỹ thuật: `item-detail.tsx` hiện đang render danh sách phẳng, phải tái cấu trúc thành
**renderer đệ quy theo cây layout**, nhận thêm cờ `editing` để quyết định render `PropertyValue` hay ô nhập.

Property **không được đặt vào layout nào** thì **không hiện ở màn Detail**. Đây chính là cơ chế "ẩn field".
Nhưng phải cảnh báo rõ trong builder: nếu có property đang bị bỏ ngoài, hiện dòng nhắc
*"N property chưa được đặt — sẽ không hiện ở Card Detail"*, tránh người dùng tưởng mất dữ liệu.

## 2.5 Template layout

- Nút **"Lưu làm mẫu"** → lưu bản sao JSON kèm tên.
- Nút **"Áp dụng mẫu"** ở gallery khác → chọn từ danh sách mẫu đã lưu.
- Khi áp mẫu sang database khác, property id gần như chắc chắn không khớp → **map theo tên property**,
  cái nào không khớp thì bỏ vào kho bên trái và báo *"X property trong mẫu không có trong database này"*.

```prisma
model LayoutTemplate {
  id        String   @id @default(cuid())
  name      String
  layout    String   // cùng JSON schema với Gallery.detailLayout
  createdAt DateTime @default(now())
}
```

## 2.6 Ràng buộc kỹ thuật

- **Không tốn thêm API call nào.** Layout thuần metadata Hallery, dữ liệu property đã có sẵn từ `dataSources.query`.
- **Thư viện kéo-thả:** cân nhắc `@dnd-kit/core` (hỗ trợ vùng thả lồng nhau, bàn phím, accessible) thay vì HTML5
  drag-and-drop thuần — HTML5 DnD xử lý vùng lồng nhau rất khó chịu. Nếu thêm dependency, ghi rõ lý do trong commit.
- **Autosave hay nút Lưu?** Chọn **nút Lưu tường minh** + cảnh báo khi rời trang lúc chưa lưu. Layout là thứ
  người dùng thử nghiệm nhiều, autosave dễ làm hỏng bố cục đang dùng thật.

## 2.7 Trường hợp biên

| Tình huống | Xử lý |
|---|---|
| Property bị xoá trong Notion nhưng còn trong layout | Renderer bỏ qua id không tồn tại. Builder hiện thẻ xám *"Property không còn tồn tại"* kèm nút gỡ. |
| Property mới thêm trong Notion | Tự xuất hiện ở kho bên trái, không tự nhét vào layout. |
| Property title | Luôn render làm tiêu đề đầu trang, **không** nằm trong layout. Không cho kéo. |
| Toàn bộ ô đều rỗng | Detail hiện trạng thái rỗng có hướng dẫn, không phải trang trắng. |
| Đổi kiểu chia ô làm giảm số ô | Property trong ô bị mất phải **dồn về ô cuối cùng**, tuyệt đối không im lặng xoá. Báo cho người dùng. |
| Layout JSON hỏng / sai version | Fallback về layout mặc định, ghi log, không crash trang. |

## 2.8 Tiêu chí nghiệm thu

1. Dựng được layout 2 cột, cột phải chia trên/dưới, mỗi ô chứa ít nhất 1 property, lưu và tải lại đúng nguyên trạng.
2. Card Detail render đúng bố cục đã dựng, tỉ lệ cột đúng như cấu hình.
3. Bấm "Sửa" giữ nguyên bố cục, các ô nhập hiện đúng vị trí property tương ứng; lưu ghi được xuống Notion.
4. Nút ⚙ trên một property number đổi được sang kiểu sao, và Card Detail phản ánh ngay.
5. Không cho tạo tầng 3: nút chia ô ở tầng 2 bị vô hiệu hoá và có giải thích.
6. Đổi kiểu chia ô từ 3 ô xuống 2 ô không làm mất property nào.
7. Gallery chưa cấu hình layout vẫn hiển thị y như trước (không cần migration).
8. `npm run build` và `npm run lint` sạch; verify trên database thật 90 item.

## 2.9 Ngoài phạm vi Phase 2

- Layout cho **card trong Gallery** (khác với Card Detail) — thuộc Phase 5 cùng hide/order field.
- Kéo thanh chia tỉ lệ tự do.
- Layout khác nhau theo kích thước màn hình. Phase 2 chỉ cần: **màn hẹp thì mọi ô xếp dọc thành 1 cột.**

---

# PHASE 3 — Formula & Category

## 3.0 Mục tiêu

Trích yêu cầu gốc:
> Fomula được xác định kiểu cuối và quản lý như trên (vd fomula cho ra number thì quản lý như 1 kiểu number)
> Category: thực chất là notion link, nhưng cho phép lấy thẳng prop của item ra ngoài display
> Gallery — Có phần Category: để xem các category của DB hiện tại (detect theo Link)

---

## 3.1 Formula

### 3.1.1 Ràng buộc đã kiểm chứng

**Schema của Notion KHÔNG cho biết formula trả ra kiểu gì.** Đã probe trên database thật:

```
Schema:  Display_Series: { "expression": "\"Series: \".style(\"b\") + ..." }   ← chỉ có expression
Value:   Display_Series: output type = string                                   ← kiểu chỉ lộ ra ở giá trị page
```

→ Muốn biết kiểu đầu ra, **bắt buộc phải đọc giá trị của ít nhất một page**. Không có đường nào khác.

### 3.1.2 Yêu cầu

1. **Phát hiện kiểu đầu ra:** khi mở `/settings/display`, lấy 1 page mẫu (`page_size: 1`, 1 API call) và đọc
   `properties[name].formula.type` cho mọi property formula.
   - Trang mẫu có formula rỗng thì `type` vẫn có, không cần lo.
   - Nếu query thất bại → hiện formula ở trạng thái "chưa xác định kiểu", vẫn render thô, không chặn cả trang.

2. **Lưu kiểu đã phát hiện** vào `PropertyConfig.notionPropertyType` dưới dạng `formula:number`, `formula:string`,
   `formula:date`, `formula:boolean`. Nhờ vậy các lần render sau không cần dò lại.

3. **Áp đúng bộ tuỳ chọn hiển thị của kiểu đó:**

   | Formula trả về | Bộ tuỳ chọn được dùng |
   |---|---|
   | `number` | plain / rate / duration / with_text — **giống hệt** Number |
   | `date` | full / month_only / year_only |
   | `string` | như Text (hiện chưa có tuỳ chọn nào, để dành) |
   | `boolean` | như Checkbox |

   Trang cài đặt hiển thị nhãn rõ: **`Rated` · formula → number**, để người dùng hiểu vì sao có mấy lựa chọn đó.

4. **Formula luôn read-only ở màn Edit** — Notion không cho ghi. Việc này đã đúng sẵn, chỉ cần đảm bảo không vỡ khi
   `notionPropertyType` đổi sang dạng `formula:*`.

5. **Rollup cũng áp dụng cơ chế tương tự.** `RollupPropertyValue` có `type: number | date | array`. Rollup ra number
   thì phải quản như number. Hiện `property-value.tsx` đã render thô, cần nối vào pipeline display config.

### 3.1.3 Trường hợp biên

| Tình huống | Xử lý |
|---|---|
| Người dùng sửa công thức trong Notion → đổi kiểu đầu ra (number → string) | Lần render sau phát hiện lệch giữa `notionPropertyType` đã lưu và kiểu thật. **Hiện cảnh báo trong settings**: *"Formula này giờ trả về string, cấu hình cũ (sao đánh giá) không dùng được nữa"* + nút cập nhật. Tuyệt đối không im lặng render sai. |
| Formula trả `string` nhưng nội dung là số | Không tự suy đoán. Người dùng muốn kiểu number thì phải sửa formula trong Notion. |
| Database rỗng, không có page để lấy mẫu | Hiện "chưa xác định kiểu — thêm ít nhất 1 item để cấu hình". |

---

## 3.2 Category

### 3.2.1 Vấn đề phát hiện được với dữ liệu thật

Yêu cầu gốc định nghĩa Category dựa trên **Notion link (Relation)**, và quyết định kiến trúc trước đây là
**Category chỉ đọc Rollup** (để tránh N+1 API call).

Nhưng probe database "Game Station" cho kết quả:

```
=== SCHEMA: relation / rollup props ===
(không có)
```

**Database thật không có Relation lẫn Rollup nào.** "Series", "Genre", "Developer", "Publisher" — đúng những thứ
mang nghĩa phân loại — đều là **multi-select**.

→ Category chỉ-đọc-Rollup sẽ chạy đúng về mặt kỹ thuật nhưng **vô dụng trên chính dữ liệu của người dùng.**

### 3.2.2 Đề xuất: Category có 2 loại trục

**Trục = một property dùng để phân loại item.** Hỗ trợ cả hai nguồn:

| Loại trục | Nguồn | Chi phí API | Dùng được với DB hiện tại |
|---|---|---|---|
| **Trục select** | `select` / `multi_select` / `status` | **0** — giá trị đã có trong query | ✅ Có (Series, Genre, Developer…) |
| **Trục liên kết** | `relation` (+ `rollup` để lấy prop hiển thị) | 1 call cho danh sách category | ❌ Chưa có |

Làm **trục select trước** — nó chạy ngay trên dữ liệu thật và tốn 0 API call. Trục liên kết làm sau, cùng cấu trúc UI.

### 3.2.3 Yêu cầu chức năng

**a) Cấu hình trục** — tại `/galleries/[galleryId]/settings/category`:
- Liệt kê mọi property đủ điều kiện làm trục (select / multi_select / status / relation).
- Cho chọn **nhiều trục**, sắp xếp thứ tự.
- Mỗi trục có: nhãn hiển thị, bật/tắt, và (với trục liên kết) chọn Rollup nào dùng làm nhãn.

**b) Thanh Category trong Gallery:**
- Hiện phía trên lưới card, dạng tab hoặc chip: `Tất cả · Assassin's Creed (7) · Mafia (3) · …`
- Có số lượng item mỗi category.
- Bấm vào → lọc gallery theo category đó. Bấm lại → bỏ lọc.
- Nhiều trục thì hiện dropdown chọn trục đang xem (`Phân loại theo: [Series ▾]`).

**c) Lọc:**
- Trục select: lọc bằng `dataSources.query` với filter `select.equals` / `multi_select.contains` → **server-side, 1 call**.
- Trục liên kết: filter `relation.contains: <page_id>`.
- Trạng thái lọc nằm trên URL (`?category=Series:Mafia`) để chia sẻ và back/forward hoạt động đúng.

**d) Đếm số lượng:**
- Trục select: đếm từ chính tập item đã tải → **0 call thêm**.
- ⚠ Chỉ chính xác trong phạm vi 100 item đầu (giới hạn hiện tại). Nếu chưa tải hết, hiện `7+` thay vì `7`,
  đừng hiển thị số sai.

**e) Category trong Card Detail:**
- Property đang là trục hiển thị dạng pill **bấm được** → quay về Gallery đã lọc theo category đó.
- Với trục liên kết: hiện thẳng prop của item liên kết (đọc từ Rollup), đúng như yêu cầu gốc
  *"cho phép lấy thẳng prop của item ra ngoài display"*.

### 3.2.4 Data model

```prisma
model CategoryAxis {
  id                 String  @id @default(cuid())
  galleryId          String
  gallery            Gallery @relation(fields: [galleryId], references: [id], onDelete: Cascade)
  notionPropertyId   String
  notionPropertyName String
  sourceType         String  // "select" | "multi_select" | "status" | "relation"
  labelRollupId      String? // chỉ dùng khi sourceType = "relation"
  displayLabel       String?
  sortOrder          Int     @default(0)
  enabled            Boolean @default(true)

  @@unique([galleryId, notionPropertyId])
}
```

### 3.2.5 Trường hợp biên

| Tình huống | Xử lý |
|---|---|
| Property làm trục bị xoá / đổi type trong Notion | Thanh Category ẩn trục đó, settings hiện cảnh báo + nút gỡ. Không crash Gallery. |
| Trục liên kết mà Rollup nhãn chưa tồn tại | Hướng dẫn người dùng **tự tạo Rollup trong Notion** — Hallery không tạo hộ (ranh giới kiến trúc). |
| Category có quá nhiều giá trị (Developer ~40 mục) | Thanh cuộn ngang + ô tìm, hoặc chỉ hiện top N kèm "Xem tất cả". |
| Item không có giá trị ở trục đó | Nhóm "Chưa phân loại", vẫn truy cập được. |
| Multi-select: item thuộc nhiều category | Bình thường — item xuất hiện ở mọi category nó thuộc về. Tổng các category sẽ lớn hơn tổng item, cần ghi chú tránh hiểu nhầm. |

### 3.2.6 Tiêu chí nghiệm thu

1. Chọn "Series" (multi_select) làm trục → thanh Category hiện đủ giá trị kèm số lượng đúng.
2. Bấm một category → gallery chỉ còn item thuộc category đó; URL phản ánh trạng thái lọc; bấm back trở lại đúng.
3. Trục select **không phát sinh thêm API call nào** so với hiện tại (đo bằng log request).
4. Formula `Rated` được nhận diện `formula → string` và hiện đúng nhãn kiểu trong settings.
5. Đổi một formula trong Notion từ number sang string → settings hiện cảnh báo lệch kiểu, không render sai.
6. Property làm trục bị xoá trong Notion → Gallery vẫn chạy, settings báo rõ.
7. `npm run build` + `npm run lint` sạch; verify trên database thật.

### 3.2.7 Ngoài phạm vi Phase 3

- Filter/Sort/Group tổng quát (Phase 5) — Category chỉ là lối lọc nhanh theo một trục.
- Sửa giá trị Relation từ Hallery (hiện vẫn read-only).
- Category lồng nhau (category của category).

---

## Thứ tự làm gợi ý

**Phase 2:** tách `/settings/display` thành component dùng chung → dựng model + renderer layout (đọc trước) →
builder kéo-thả → gộp Edit vào layout → template.

**Phase 3:** formula (nhỏ, độc lập, làm trước để có thắng lợi sớm) → trục Category loại select →
thanh Category + lọc → trục liên kết + Rollup.
