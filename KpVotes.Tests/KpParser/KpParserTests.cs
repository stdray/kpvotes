using KpVotes.Kinopoisk;

namespace KpVotes.Tests.KpParser;

public class KpParserTests
{
    static string SamplePath => Path.Combine(AppContext.BaseDirectory, "KpParser", "data", "votes_sample.big.htm");

    [Fact]
    public void Parse_ReturnsExpectedVotesFromSample()
    {
        var html = File.ReadAllText(SamplePath);
        var parser = new Kinopoisk.KpParser();

        var result = parser.Parse(html);

        var votes = Assert.IsType<KpParserResult.UserVotes>(result).Votes;

        var witchVote = Assert.Single(votes, v => v.Name == "Ведьма (2018)");
        Assert.Equal(6, witchVote.Vote);

        var nakedGunVote = Assert.Single(votes, v => v.Name == "Голый пистолет (2025)");
        Assert.Equal(5, nakedGunVote.Vote);
    }
}