using AngleSharp.Html.Parser;

namespace KpVotes.Kinopoisk;

public class KpParser : IKpParser
{
    public KpParserResult Parse(string html)
    {
        var parser = new HtmlParser();
        var doc = parser.ParseDocument(html);
        if (doc.QuerySelectorAll(Const.CaptchaSelector).Any())
            return new KpParserResult.Captcha();
        var query =
            from item in doc.QuerySelectorAll(Const.VotesSelector)
            let name = item.QuerySelector(".nameRus a")
            let vote = item.QuerySelector(".vote") ?? item.QuerySelector(".myVote")
            where name is not null && vote is not null
            let href = name.GetAttribute("href")
            where !string.IsNullOrEmpty(href)
            select new KpVote
            (
                href!,
                name.TextContent,
                int.Parse(vote.TextContent)
            );
        return new KpParserResult.UserVotes(query.Reverse().ToArray());
    }
}