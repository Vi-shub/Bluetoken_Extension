/**
 * Public links shown in the panel, status bar, and Marketplace metadata.
 *
 * Project site is set. When you create the GitHub repo, update `github` +
 * `repository` below and the matching fields in package.json.
 */
export const LINKS = {
  /** Author / profile (GitHub). Update when the public repo exists. */
  github: "https://github.com/YOUR_GITHUB_USERNAME",
  /** This extension's repository. Update to match your public GitHub repo. */
  repository: "https://github.com/YOUR_GITHUB_USERNAME/bluetoken",
  /** Author / project site */
  project: "https://www.shubhamvishwakarma.com",
  papers: [
    {
      label: "Making AI Less Thirsty (UC Riverside / arXiv)",
      url: "https://arxiv.org/abs/2304.03271",
    },
    {
      label: "Making AI Less Thirsty (ACM)",
      url: "https://doi.org/10.1145/3724499",
    },
    {
      label: "UCR News summary",
      url: "https://news.ucr.edu/articles/2023/04/28/ai-programs-consume-large-volumes-scarce-water",
    },
  ],
} as const;

export function isPlaceholderUrl(url: string): boolean {
  return /YOUR_|PLACEHOLDER/i.test(url);
}
