using Quartz;

namespace KpVotes.Quartz;

public static class QuartzExtensions
{
    public static IServiceCollectionQuartzConfigurator ScheduleJob<T>(this IServiceCollectionQuartzConfigurator q,
        TimeSpan? interval = null, string? cronExpr = null, bool startNow = false, TimeSpan? startNowDelay = null)
        where T : IJob
    {
        if (!interval.HasValue && string.IsNullOrEmpty(cronExpr) && !startNow) return q;
        var name = typeof(T).Name;
        var key = new JobKey(name);
        q.AddJob<T>(c => c.WithIdentity(key).DisallowConcurrentExecution());
        if (interval.HasValue)
            q.AddTrigger(c => c
                .ForJob(key)
                .WithIdentity($"{name}_Interval")
                .WithSimpleSchedule(b => b
                    .WithMisfireHandlingInstructionNextWithRemainingCount()
                    .WithInterval(interval.Value)
                    .RepeatForever()));
        if (!string.IsNullOrEmpty(cronExpr))
            q.AddTrigger(c => c
                .ForJob(key)
                .WithIdentity($"{name}_Cron")
                .WithCronSchedule(cronExpr, b => b.WithMisfireHandlingInstructionDoNothing()));
        if (startNow)
            q.AddTrigger(c => c
                .ForJob(key)
                .WithIdentity($"{name}_StartNow")
                .WithSimpleSchedule(b => b.WithMisfireHandlingInstructionNextWithRemainingCount())
                .StartAt(DateTimeOffset.UtcNow.Add(startNowDelay ?? TimeSpan.FromSeconds(10))));
        return q;
    }
}