using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace KpVotes.Kinopoisk;

public class KpParser : IKpParser
{
    public KpParserResult Parse(string html)
    {
        var parser = new HtmlParser();
        var doc = parser.ParseDocument(html);
        if (doc.QuerySelectorAll(Const.CaptchaSelector).Length > 0)
            return new KpParserResult.Captcha();
        var query =
            from item in doc.QuerySelectorAll(Const.VotesSelector)
            let name = item.QuerySelector(".nameRus a")
            let voteValue = TryGetVote(item)
            where name is not null && voteValue.HasValue
            let href = name.GetAttribute("href")
            where !string.IsNullOrEmpty(href)
            select new KpVote
            (
                href!,
                name.TextContent.Trim(),
                voteValue.Value
            );
        return new KpParserResult.UserVotes(query.Reverse().ToArray());
    }

    static int? TryGetVote(IElement item)
    {
        var voteElement = item.QuerySelector(".vote") ?? item.QuerySelector(".myVote");
        var voteText = voteElement?.TextContent.Trim() ?? string.Empty;
        if (!string.IsNullOrEmpty(voteText) && int.TryParse(voteText, out var value))
            return value;

        foreach (var script in item.QuerySelectorAll("script"))
        {
            var match = RatingRegex.Match(script.TextContent);
            if (match.Success && int.TryParse(match.Groups["value"].Value, out var rating))
                return rating;
        }

        return null;
    }

    static readonly Regex RatingRegex = new(@"rating:\s*'(?<value>\d+)'", RegexOptions.Compiled);
}