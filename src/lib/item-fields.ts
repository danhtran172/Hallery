import type { DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { createDefaultCardLayout, parseCardLayout, TITLE_FIELD_ID, type CardLayout } from "@/lib/card-layout";
import { asFormLayout } from "@/lib/card-layout-edit";
import { parseViewLayoutConfig } from "@/lib/gallery-view";
import { isHalleryButtonId, isImportedNotionType } from "@/lib/native-button";
import { parseGalleryConfig } from "@/lib/notion-cover";
import { EDITABLE_PROPERTY_TYPES, READONLY_PROPERTY_TYPES } from "@/lib/notion-write";
import { getTitlePropertyName } from "@/lib/notion-schema";
import { halleryButtonValue } from "@/lib/page-properties";

export type FieldData = {
  propertyId: string;
  name: string;
  type: string;
  value: PageObjectResponse["properties"][string];
  editable: boolean;
  readonly: boolean;
  options?: string[];
  displayConfig: DisplayConfig;
  /** The value shown is a button's preset, not what the record holds now. */
  prefilled?: boolean;
};

type FieldPropertyConfig = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  displayConfig: string;
  detailDisplayConfig: string;
  sortOrder: number;
  disabled: boolean;
};

/**
 * A page's properties as the detail and its edit forms draw them: Notion's values with
 * Hallery's names and formats, select options for the pickers, Hallery-only buttons
 * alongside, in Hallery's property order. The title comes back on its own.
 */
export function buildItemFields(
  page: PageObjectResponse,
  dataSource: DataSourceObjectResponse,
  propertyConfigs: FieldPropertyConfig[],
): { titleField: FieldData | null; fields: FieldData[] } {
  const titlePropertyName = getTitlePropertyName(dataSource.properties);
  const configsById = new Map(propertyConfigs.map((config) => [config.notionPropertyId, config]));
  const formatOf = (id: string) => {
    const config = configsById.get(id);
    return config ? parseDisplayConfig(config.detailDisplayConfig || config.displayConfig) : {};
  };

  const fields: FieldData[] = Object.entries(page.properties)
    .filter(([name, value]) => name !== titlePropertyName && isImportedNotionType(value.type))
    .map(([name, value]) => {
      const schema = dataSource.properties[name];
      let options: string[] | undefined;
      if (schema?.type === "select") options = schema.select.options.map((option) => option.name);
      if (schema?.type === "status") options = schema.status.options.map((option) => option.name);
      if (schema?.type === "multi_select") options = schema.multi_select.options.map((option) => option.name);
      return {
        propertyId: value.id,
        name,
        type: value.type,
        value,
        editable: EDITABLE_PROPERTY_TYPES.has(value.type),
        readonly: READONLY_PROPERTY_TYPES.has(value.type),
        options,
        displayConfig: formatOf(value.id),
      };
    });
  for (const config of propertyConfigs) {
    if (!isHalleryButtonId(config.notionPropertyId) || config.disabled) continue;
    fields.push({
      propertyId: config.notionPropertyId,
      name: config.notionPropertyName,
      type: "button",
      value: halleryButtonValue(config.notionPropertyId),
      editable: false,
      readonly: true,
      displayConfig: formatOf(config.notionPropertyId),
    });
  }
  fields.sort((a, b) => {
    const aOrder = configsById.get(a.propertyId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = configsById.get(b.propertyId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.name.localeCompare(b.name, "vi");
  });

  const titleValue = titlePropertyName ? page.properties[titlePropertyName] : undefined;
  const titleField: FieldData | null =
    titleValue && titlePropertyName
      ? {
          propertyId: titleValue.id,
          name: titlePropertyName,
          type: "title",
          value: titleValue,
          editable: true,
          readonly: false,
          displayConfig: {},
        }
      : null;

  return { titleField, fields };
}

/**
 * The gallery's own edit form as a form layout: the Card Detail of the first view, without
 * its cover, with the title on top (the edit mode always shows it). A button's form starts
 * from this, and uses it as is until someone arranges one of its own.
 */
export function defaultFormLayout(
  gallery: { displayConfig: string; views: { id: string; layoutConfig: string }[] },
  propertyConfigs: (FieldPropertyConfig & { isMissing: boolean })[],
): CardLayout {
  const view = gallery.views[0];
  const legacy = parseGalleryConfig(gallery.displayConfig);
  const config = view ? parseViewLayoutConfig(view.layoutConfig, legacy) : legacy;
  const card = parseCardLayout(config.card) ?? createDefaultCardLayout(propertyConfigs);
  const form = asFormLayout(parseCardLayout(config.detailCard) ?? card);
  const placed = Object.values(form.regions).some((grid) =>
    grid.boxes.some((box) => box.fields.some((field) => field.id === TITLE_FIELD_ID)),
  );
  if (placed) return form;
  const [regionId, grid] = Object.entries(form.regions)[0];
  const boxes = [...grid.boxes];
  boxes[0] = { ...boxes[0], fields: [{ id: TITLE_FIELD_ID, showLabel: true }, ...boxes[0].fields] };
  return { ...form, regions: { [regionId]: { ...grid, boxes } } };
}
