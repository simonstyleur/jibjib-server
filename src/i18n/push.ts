// Push notification copy in the app's three languages. The recipient's
// users.language column (kept fresh by the mobile app's PATCH /user/me on
// language change) picks the variant — previously every push was English.

export type PushLanguage = "en" | "fr" | "ar";

export type PushTemplate =
  | "item_added_one"
  | "items_added_many"
  | "message_text"
  | "message_sticker"
  | "trip_started"
  | "trip_completed"
  | "partner_joined";

interface PushCopy {
  title: string;
  body: string;
}

type Params = Record<string, string | number>;

// {placeholders} are replaced from params. `partnerFallback` is the name used
// when the actor's account has no name.
export const PARTNER_FALLBACK: Record<PushLanguage, string> = {
  en: "Your partner",
  fr: "Votre partenaire",
  ar: "شريكك",
};

const TEMPLATES: Record<PushTemplate, Record<PushLanguage, PushCopy>> = {
  item_added_one: {
    en: { title: "New item added", body: '{name} added "{item}" to the list' },
    fr: { title: "Nouvel article ajouté", body: "{name} a ajouté « {item} » à la liste" },
    ar: { title: "عنصر جديد", body: "أضاف {name} «{item}» إلى القائمة" },
  },
  items_added_many: {
    en: { title: "New items added", body: "{name} added {count} items: {items}" },
    fr: { title: "Nouveaux articles ajoutés", body: "{name} a ajouté {count} articles : {items}" },
    ar: { title: "عناصر جديدة", body: "أضاف {name} {count} عناصر: {items}" },
  },
  message_text: {
    // Title is the item name (passed as a param so it stays verbatim).
    en: { title: "{item}", body: "{name}: {text}" },
    fr: { title: "{item}", body: "{name} : {text}" },
    ar: { title: "{item}", body: "{name}: {text}" },
  },
  message_sticker: {
    en: { title: "{item}", body: "{name} sent a sticker on {item}" },
    fr: { title: "{item}", body: "{name} a envoyé un autocollant sur {item}" },
    ar: { title: "{item}", body: "أرسل {name} ملصقًا على {item}" },
  },
  trip_started: {
    en: { title: "Shopping trip started!", body: "{name} is heading to the store with {count} items" },
    fr: { title: "Les courses commencent !", body: "{name} part au magasin avec {count} articles" },
    ar: { title: "بدأت رحلة التسوق!", body: "{name} في طريقه إلى المتجر ومعه {count} عناصر" },
  },
  trip_completed: {
    en: { title: "Shopping trip completed!", body: "{name} finished shopping in {minutes} min — {count} items bought" },
    fr: { title: "Courses terminées !", body: "{name} a fini les courses en {minutes} min — {count} articles achetés" },
    ar: { title: "اكتملت رحلة التسوق!", body: "أنهى {name} التسوق في {minutes} دقيقة — تم شراء {count} عناصر" },
  },
  partner_joined: {
    en: { title: "Partner joined!", body: "{name} has joined your JibJib pair" },
    fr: { title: "Votre partenaire est là !", body: "{name} a rejoint votre duo JibJib" },
    ar: { title: "انضم شريكك!", body: "انضم {name} إلى ثنائي جيب جيب الخاص بك" },
  },
};

export function renderPush(
  language: string | null | undefined,
  template: PushTemplate,
  params: Params,
): PushCopy {
  const lang: PushLanguage =
    language === "fr" || language === "ar" ? language : "en";
  const copy = TEMPLATES[template][lang];
  const fill = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_m, key) =>
      params[key] !== undefined ? String(params[key]) : `{${key}}`,
    );
  return { title: fill(copy.title), body: fill(copy.body) };
}
