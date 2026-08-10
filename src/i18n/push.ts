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

// ── Counted nouns ────────────────────────────────────────────────────────
//
// Pushes used to interpolate a bare {count} next to a hard-coded plural noun,
// so a single item read "1 items bought". Fixing that per template would mean
// writing every full sentence once per plural category — and Arabic has SIX
// (zero, one, two, few, many, other), against two for English and French.
//
// Instead each counted noun is declared once here and the sentence refers to
// the resolved phrase. {n} is the numeral, omitted in the forms where spelling
// it out reads better than a digit ("عنصر واحد", not "1 عنصر").
//
// The Arabic dual and the many/other split are the reason this cannot be
// approximated: 2 needs عنصرين, 3–10 عناصر, 11–99 عنصراً, 100+ عنصر. These
// forms are also chosen to sit after a preposition or verb, which is where our
// templates put them — worth a native speaker's eye if the copy ever moves.
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const NOUNS = {
  item: {
    en: { one: "{n} item", other: "{n} items" },
    fr: { one: "{n} article", other: "{n} articles" },
    ar: {
      zero: "لا عناصر",
      one: "عنصر واحد",
      two: "عنصرين",
      few: "{n} عناصر",
      many: "{n} عنصراً",
      other: "{n} عنصر",
    },
  },
  minute: {
    en: { one: "{n} min", other: "{n} min" },
    fr: { one: "{n} min", other: "{n} min" },
    ar: {
      zero: "أقل من دقيقة",
      one: "دقيقة واحدة",
      two: "دقيقتين",
      few: "{n} دقائق",
      many: "{n} دقيقة",
      other: "{n} دقيقة",
    },
  },
} satisfies Record<string, Record<PushLanguage, PluralForms>>;

type CountedNoun = keyof typeof NOUNS;

/** Resolve a counted noun to the phrase for `n` in `lang`. */
export function countedNoun(lang: PushLanguage, noun: CountedNoun, n: number): string {
  const forms = NOUNS[noun][lang];
  const category = new Intl.PluralRules(lang).select(n);
  // `other` is required by the type, so this always resolves to a string even
  // for a language that gains a category we have not written copy for.
  const form = (forms as PluralForms)[category] ?? forms.other;
  return form.replace("{n}", String(n));
}

// ── Templates ────────────────────────────────────────────────────────────
//
// {items} is the counted-noun phrase, injected by renderPush from params.count.
// {minutes_phrase} likewise, from params.minutes. {item} and {items_list} stay
// verbatim user content.

// A body may itself vary by plural category, for agreement the counted-noun
// phrase cannot carry: the French past participle has to match ("1 article
// acheté" vs "3 articles achetés"), and zero reads better as its own sentence
// than as "0 items bought".
interface TemplateCopy {
  title: string;
  body: string | PluralForms;
}

const TEMPLATES: Record<PushTemplate, Record<PushLanguage, TemplateCopy>> = {
  item_added_one: {
    en: { title: "New item added", body: '{name} added "{item}" to the list' },
    fr: { title: "Nouvel article ajouté", body: "{name} a ajouté « {item} » à la liste" },
    ar: { title: "عنصر جديد", body: "أضاف {name} «{item}» إلى القائمة" },
  },
  items_added_many: {
    en: { title: "New items added", body: "{name} added {items}: {items_list}" },
    fr: { title: "Nouveaux articles ajoutés", body: "{name} a ajouté {items} : {items_list}" },
    ar: { title: "عناصر جديدة", body: "أضاف {name} {items}: {items_list}" },
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
    en: { title: "Shopping trip started!", body: "{name} is heading to the store with {items}" },
    fr: { title: "Les courses commencent !", body: "{name} part au magasin avec {items}" },
    ar: { title: "بدأت رحلة التسوق!", body: "{name} في طريقه إلى المتجر ومعه {items}" },
  },
  trip_completed: {
    en: {
      title: "Shopping trip completed!",
      body: {
        zero: "{name} finished shopping in {minutes_phrase} — nothing bought",
        other: "{name} finished shopping in {minutes_phrase} — {items} bought",
      },
    },
    fr: {
      title: "Courses terminées !",
      body: {
        // English "zero" never fires for fr (0 resolves to one), so the
        // nothing-bought case lives in `one` guarded by the count.
        one: "{name} a fini les courses en {minutes_phrase} — {items} acheté",
        other: "{name} a fini les courses en {minutes_phrase} — {items} achetés",
      },
    },
    ar: {
      title: "اكتملت رحلة التسوق!",
      body: {
        zero: "أنهى {name} التسوق في {minutes_phrase} — لم يتم شراء أي عنصر",
        other: "أنهى {name} التسوق في {minutes_phrase} — تم شراء {items}",
      },
    },
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

  // Derive the counted-noun phrases so callers keep passing plain numbers.
  const resolved: Params = { ...params };
  if (params.count !== undefined) {
    resolved.items = countedNoun(lang, "item", Number(params.count));
  }
  if (params.minutes !== undefined) {
    resolved.minutes_phrase = countedNoun(lang, "minute", Number(params.minutes));
  }

  const fill = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_m, key) =>
      resolved[key] !== undefined ? String(resolved[key]) : `{${key}}`,
    );

  let body: string;
  if (typeof copy.body === "string") {
    body = copy.body;
  } else {
    const n = Number(params.count ?? 0);
    // An explicit zero wins over the CLDR category, the way ICU's `=0` does.
    // English and French have no `zero` category at all (0 resolves to `other`
    // and `one` respectively), so keying only off the category would silently
    // drop a "nothing bought" variant in exactly the languages that need it
    // spelled out.
    const category = new Intl.PluralRules(lang).select(n);
    body =
      (n === 0 ? copy.body.zero : undefined) ??
      copy.body[category] ??
      copy.body.other;
  }

  return { title: fill(copy.title), body: fill(body) };
}
