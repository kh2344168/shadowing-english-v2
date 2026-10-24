BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023092009_ExpandStudentAiFeedback'
)
BEGIN
    DECLARE @var nvarchar(max);
    SELECT @var = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[StudentPracticeAttempts]') AND [c].[name] = N'FeedbackJson');
    IF @var IS NOT NULL EXEC(N'ALTER TABLE [StudentPracticeAttempts] DROP CONSTRAINT ' + @var + ';');
    ALTER TABLE [StudentPracticeAttempts] ALTER COLUMN [FeedbackJson] nvarchar(max) NOT NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261023092009_ExpandStudentAiFeedback'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261023092009_ExpandStudentAiFeedback', N'10.0.10');
END;

COMMIT;
GO

