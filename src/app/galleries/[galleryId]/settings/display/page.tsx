import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseDisplayConfig } from "@/lib/display-config";
import { saveDisplayConfig } from "./actions";

const CONFIGURABLE_TYPES = new Set(["number", "url", "date", "select", "status", "multi_select"]);

export default async function DisplaySettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/display">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const properties = gallery.propertyConfigs.filter((p) => p.notionPropertyType !== "title");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Cài đặt hiển thị</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn cách mỗi property hiển thị trong Gallery và Card Detail — không đổi gì trong Notion, chỉ đổi cách
        Hallery đọc và trình bày lại giá trị.
      </p>

      <div className="flex flex-col gap-4">
        {properties.map((p) => (
          <PropertyConfigCard key={p.id} galleryId={galleryId} property={p} />
        ))}
      </div>
    </div>
  );
}

function PropertyConfigCard({
  galleryId,
  property,
}: {
  galleryId: string;
  property: {
    id: string;
    notionPropertyName: string;
    notionPropertyType: string;
    displayConfig: string;
  };
}) {
  const cfg = parseDisplayConfig(property.displayConfig);
  const action = saveDisplayConfig.bind(null, galleryId, property.id, property.notionPropertyType);
  const configurable = CONFIGURABLE_TYPES.has(property.notionPropertyType);

  return (
    <div className="rounded-lg border border-stone-200 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-medium text-stone-900">{property.notionPropertyName}</span>
        <span className="font-mono text-xs text-stone-400">{property.notionPropertyType}</span>
      </div>

      {!configurable ? (
        <p className="text-sm text-stone-400">Chưa có tuỳ chỉnh hiển thị cho kiểu này.</p>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          {property.notionPropertyType === "number" && <NumberFields cfg={cfg} />}
          {property.notionPropertyType === "url" && <UrlFields cfg={cfg} />}
          {property.notionPropertyType === "date" && <DateFields cfg={cfg} />}
          {["select", "status", "multi_select"].includes(property.notionPropertyType) && (
            <AffixFields cfg={cfg} />
          )}
          <button
            type="submit"
            className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
          >
            Lưu
          </button>
        </form>
      )}
    </div>
  );
}

function NumberFields({ cfg }: { cfg: { kind?: string; max?: number; prefix?: string; suffix?: string } }) {
  return (
    <>
      <RadioGroup
        name="kind"
        defaultValue={cfg.kind ?? "plain"}
        options={[
          { value: "plain", label: "Số thường" },
          { value: "rate", label: "Số sao (Rate)" },
          { value: "duration", label: "Giờ : phút — số ghi trong Notion vẫn là tổng phút" },
          { value: "with_text", label: "Kèm chữ trước/sau" },
        ]}
      />
      <TextField name="max" label="Số sao tối đa (chỉ dùng khi chọn Rate)" defaultValue={String(cfg.max ?? 5)} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="prefix" label="Chữ trước (With text)" defaultValue={cfg.prefix ?? ""} />
        <TextField name="suffix" label="Chữ sau (With text)" defaultValue={cfg.suffix ?? ""} />
      </div>
    </>
  );
}

function UrlFields({ cfg }: { cfg: { kind?: string; label?: string } }) {
  return (
    <>
      <RadioGroup
        name="kind"
        defaultValue={cfg.kind ?? "link"}
        options={[
          { value: "link", label: "Link thường" },
          { value: "button", label: "Nút bấm" },
        ]}
      />
      <TextField name="label" label="Chữ trên nút (chỉ dùng khi chọn Nút bấm)" defaultValue={cfg.label ?? ""} />
    </>
  );
}

function DateFields({ cfg }: { cfg: { kind?: string } }) {
  return (
    <RadioGroup
      name="kind"
      defaultValue={cfg.kind ?? "full"}
      options={[
        { value: "full", label: "Đầy đủ (ngày/tháng/năm)" },
        { value: "month_only", label: "Chỉ tháng" },
        { value: "year_only", label: "Chỉ năm" },
      ]}
    />
  );
}

function AffixFields({ cfg }: { cfg: { prefix?: string; suffix?: string } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField name="prefix" label="Chữ trước" defaultValue={cfg.prefix ?? ""} />
      <TextField name="suffix" label="Chữ sau" defaultValue={cfg.suffix ?? ""} />
    </div>
  );
}

function RadioGroup({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 text-sm text-stone-700">
          <input type="radio" name={name} value={opt.value} defaultChecked={defaultValue === opt.value} />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function TextField({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-stone-500">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
      />
    </label>
  );
}
