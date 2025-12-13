using AngleSharp;
using AngleSharp.Io;
using Microsoft.Extensions.Options;

namespace KpVotes.Kinopoisk;

public class AngleSharpLoader(IOptionsSnapshot<AngleSharpLoaderOptions> options) : IKpLoader
{
    public async Task<string> Load(Uri uri, CancellationToken cancellation)
    {
        var requester = new DefaultHttpRequester
        {
            Headers = { ["User-Agent"] = options.Value.UserAgent }
        };
        var config = Configuration.Default.WithDefaultLoader().With(requester);
        using var context = BrowsingContext.New(config);
        using var doc = await context.OpenAsync(uri.ToString(), cancellation: cancellation);
        return doc.ToHtml();
    }
}