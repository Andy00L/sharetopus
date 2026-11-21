type TitledText = { title: string; body: string };

type TitleFormat = {
  separator: string;
  formatTitle: (title: string) => string;
};

const TITLE_AS_FIRST_PARAGRAPH: TitleFormat = {
  separator: "\n\n",
  formatTitle: (title) => title,
};

export function joinTitleAndBody(
  post: TitledText,
  titleFormat: Partial<TitleFormat> = {},
): string {
  const { separator, formatTitle } = { ...TITLE_AS_FIRST_PARAGRAPH, ...titleFormat };
  const trimmedTitle = post.title.trim();
  return [trimmedTitle ? formatTitle(trimmedTitle) : "", post.body.trim()]
    .filter((part) => part.length > 0)
    .join(separator);
}
