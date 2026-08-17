import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import {
  CONTENT_IMAGE,
  COVER_RATIOS,
  PAGE_COVER,
  PROPERTY_PREFIX,
  listImagePropertyNames,
  parseGalleryConfig,
} from "@/lib/notion-cover";
import { CoverShapePicker } from "./cover-shape-picker";
import { saveCoverSettings } from "./aspect-actions";

export default async function CoverSettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/cover">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) notFound();

  const notion = getNotionClient(gallery.workspace.accessToken);
  const dataSource = await notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId });
  const imageProperties = isFullDataSource(dataSource) ? listImagePropertyNames(dataSource) : [];

  const config = parseGalleryConfig(gallery.displayConfig);
  const aspect = config.coverAspect ?? "landscape";
  const source = config.coverSource ?? PAGE_COVER;
  const ratio =
    aspect === "none"
      ? COVER_RATIOS.landscape[0]
      : (config.coverRatio ?? COVER_RATIOS[aspect][0]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Ảnh bìa</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn ảnh nào hiện trên card và khung ảnh ra sao. Hallery chỉ đọc — không sửa gì trong Notion.
      </p>

      <form action={saveCoverSettings.bind(null, galleryId)} className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-stone-700">Lấy ảnh từ đâu</h2>
          <div className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-5">
            <Radio
              name="coverSource"
              value={PAGE_COVER}
              checked={source === PAGE_COVER}
              label="Ảnh bìa của page"
              hint="Ảnh bìa mặc định bạn đặt trong Notion."
            />
            {imageProperties.map((name) => (
              <Radio
                key={name}
                name="coverSource"
                value={`${PROPERTY_PREFIX}${name}`}
                checked={source === `${PROPERTY_PREFIX}${name}`}
                label={`Prop: ${name}`}
              />
            ))}
            <Radio
              name="coverSource"
              value={CONTENT_IMAGE}
              checked={source === CONTENT_IMAGE}
              label="Ảnh trong nội dung page"
              hint="Lấy ảnh đầu tiên bên trong page. Tải dần khi cuộn tới và được nhớ lại, nên lần đầu card sẽ hiện ảnh chậm hơn một nhịp."
            />
            {imageProperties.length === 0 && (
              <p className="mt-2 text-xs text-stone-400">
                Database này chưa có prop kiểu Files hay URL nào để làm ảnh bìa.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-stone-700">Khung ảnh trên card</h2>
          <CoverShapePicker initialAspect={aspect} initialRatio={ratio} />
        </section>

        <button
          type="submit"
          className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Lưu
        </button>
      </form>
    </div>
  );
}

function Radio({
  name,
  value,
  checked,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-stone-700">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="mt-1" />
      <span>
        {label}
        {hint && <span className="block text-xs text-stone-400">{hint}</span>}
      </span>
    </label>
  );
}
