using AngleSharp.Html.Parser;
using KpVotes.Jobs;
using KpVotes.Kinopoisk;
using KpVotes.Quartz;
using KpVotes.Twitter;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NLog.Extensions.Logging;
using Quartz;

Host.CreateDefaultBuilder(args)
    .UseWindowsService()
    .ConfigureAppConfiguration((_, config) => { config.AddEnvironmentVariables("KpVotes_"); })
    .ConfigureLogging((_, logging) =>
    {
        logging.ClearProviders();
        logging.AddNLog();
    })
    .ConfigureServices((context, services) =>
    {
        Console.WriteLine("ConfigureServices: {0}", context.HostingEnvironment.EnvironmentName);
        
        services.AddScoped<IHtmlParser, HtmlParser>();
        services.AddSingleton<IKpParser, KpParser>();

        services.AddOptions<ProxyOptions>().BindConfiguration(nameof(ProxyOptions));
        services.AddOptions<TwitterCredentials>().BindConfiguration(nameof(TwitterCredentials));
        
        services.AddOptions<AngleSharpLoaderOptions>().BindConfiguration(nameof(AngleSharpLoaderOptions));
        services.AddScoped<IKpLoader, AngleSharpLoader>();
        
        services.AddOptions<ProxyOptions>().BindConfiguration(nameof(ProxyOptions));
        services.AddOptions<TwitterCredentials>().BindConfiguration(nameof(TwitterCredentials));
        services.AddScoped<ITwitterClient, TwitterClient>();
        
        services.AddOptions<KpVotesJobOptions>().BindConfiguration(nameof(KpVotesJobOptions));
        services.AddScoped<KpVotesJob>();

        var jobOptions = context.Configuration
            .GetSection(nameof(KpVotesJobOptions))
            .Get<KpVotesJobOptions>();
        services.AddQuartz(q => q.ScheduleJob<KpVotesJob>(jobOptions.Interval));
        services.AddQuartzHostedService(q =>
        {
            q.WaitForJobsToComplete = true;
            q.AwaitApplicationStarted = true;
        });
    })
    .Build()
    .Run();