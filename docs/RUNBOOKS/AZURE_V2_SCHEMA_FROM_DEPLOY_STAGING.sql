IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetRoles] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(256) NULL,
        [NormalizedName] nvarchar(256) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoles] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetUsers] (
        [Id] uniqueidentifier NOT NULL,
        [UserName] nvarchar(256) NULL,
        [NormalizedUserName] nvarchar(256) NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [EmailConfirmed] bit NOT NULL,
        [PasswordHash] nvarchar(max) NULL,
        [SecurityStamp] nvarchar(max) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        [PhoneNumber] nvarchar(max) NULL,
        [PhoneNumberConfirmed] bit NOT NULL,
        [TwoFactorEnabled] bit NOT NULL,
        [LockoutEnd] datetimeoffset NULL,
        [LockoutEnabled] bit NOT NULL,
        [AccessFailedCount] int NOT NULL,
        CONSTRAINT [PK_AspNetUsers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetRoleClaims] (
        [Id] int NOT NULL IDENTITY,
        [RoleId] uniqueidentifier NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoleClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetRoleClaims_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserClaims] (
        [Id] int NOT NULL IDENTITY,
        [UserId] uniqueidentifier NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetUserClaims_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserLogins] (
        [LoginProvider] nvarchar(450) NOT NULL,
        [ProviderKey] nvarchar(450) NOT NULL,
        [ProviderDisplayName] nvarchar(max) NULL,
        [UserId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_AspNetUserLogins] PRIMARY KEY ([LoginProvider], [ProviderKey]),
        CONSTRAINT [FK_AspNetUserLogins_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserRoles] (
        [UserId] uniqueidentifier NOT NULL,
        [RoleId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_AspNetUserRoles] PRIMARY KEY ([UserId], [RoleId]),
        CONSTRAINT [FK_AspNetUserRoles_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_AspNetUserRoles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserTokens] (
        [UserId] uniqueidentifier NOT NULL,
        [LoginProvider] nvarchar(450) NOT NULL,
        [Name] nvarchar(450) NOT NULL,
        [Value] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserTokens] PRIMARY KEY ([UserId], [LoginProvider], [Name]),
        CONSTRAINT [FK_AspNetUserTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetRoleClaims_RoleId] ON [AspNetRoleClaims] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [RoleNameIndex] ON [AspNetRoles] ([NormalizedName]) WHERE [NormalizedName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetUserClaims_UserId] ON [AspNetUserClaims] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetUserLogins_UserId] ON [AspNetUserLogins] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetUserRoles_RoleId] ON [AspNetUserRoles] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [EmailIndex] ON [AspNetUsers] ([NormalizedEmail]) WHERE [NormalizedEmail] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UserNameIndex] ON [AspNetUsers] ([NormalizedUserName]) WHERE [NormalizedUserName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923074328_InitialIdentity'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260923074328_InitialIdentity', N'10.0.10');
END;

COMMIT;
GO
BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE TABLE [StudyGroups] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(120) NOT NULL,
        [CreateRequestId] uniqueidentifier NOT NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        [CreatedByAdminId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_StudyGroups] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_StudyGroups_AspNetUsers_CreatedByAdminId] FOREIGN KEY ([CreatedByAdminId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE TABLE [StudentGroupMemberships] (
        [Id] uniqueidentifier NOT NULL,
        [StudentId] uniqueidentifier NOT NULL,
        [GroupId] uniqueidentifier NOT NULL,
        [StartedAtUtc] datetimeoffset NOT NULL,
        [EndedAtUtc] datetimeoffset NULL,
        [AssignedByAdminId] uniqueidentifier NOT NULL,
        [EndedByAdminId] uniqueidentifier NULL,
        CONSTRAINT [PK_StudentGroupMemberships] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_StudentGroupMemberships_EndAfterStart] CHECK ([EndedAtUtc] IS NULL OR [EndedAtUtc] >= [StartedAtUtc]),
        CONSTRAINT [FK_StudentGroupMemberships_AspNetUsers_AssignedByAdminId] FOREIGN KEY ([AssignedByAdminId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentGroupMemberships_AspNetUsers_EndedByAdminId] FOREIGN KEY ([EndedByAdminId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentGroupMemberships_AspNetUsers_StudentId] FOREIGN KEY ([StudentId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentGroupMemberships_StudyGroups_GroupId] FOREIGN KEY ([GroupId]) REFERENCES [StudyGroups] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE INDEX [IX_StudyGroups_CreatedByAdminId] ON [StudyGroups] ([CreatedByAdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE UNIQUE INDEX [IX_StudyGroups_CreateRequestId] ON [StudyGroups] ([CreateRequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE INDEX [IX_StudentGroupMemberships_AssignedByAdminId] ON [StudentGroupMemberships] ([AssignedByAdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE INDEX [IX_StudentGroupMemberships_EndedByAdminId] ON [StudentGroupMemberships] ([EndedByAdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE INDEX [IX_StudentGroupMemberships_GroupId_EndedAtUtc] ON [StudentGroupMemberships] ([GroupId], [EndedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    CREATE INDEX [IX_StudentGroupMemberships_StudentId_StartedAtUtc] ON [StudentGroupMemberships] ([StudentId], [StartedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UX_StudentGroupMemberships_ActiveStudent] ON [StudentGroupMemberships] ([StudentId]) WHERE [EndedAtUtc] IS NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928154813_AddGroupsFoundation'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260928154813_AddGroupsFoundation', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [CurriculumTemplates] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(160) NOT NULL,
        CONSTRAINT [PK_CurriculumTemplates] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [LessonDefinitions] (
        [Id] uniqueidentifier NOT NULL,
        [Title] nvarchar(160) NOT NULL,
        CONSTRAINT [PK_LessonDefinitions] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [LessonVersions] (
        [Id] uniqueidentifier NOT NULL,
        [LessonDefinitionId] uniqueidentifier NOT NULL,
        [VersionNumber] int NOT NULL,
        [Title] nvarchar(160) NOT NULL,
        [Description] nvarchar(1000) NOT NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_LessonVersions] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_LessonVersions_Number] CHECK ([VersionNumber] > 0),
        CONSTRAINT [FK_LessonVersions_LessonDefinitions_LessonDefinitionId] FOREIGN KEY ([LessonDefinitionId]) REFERENCES [LessonDefinitions] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [PublishedCurriculumVersions] (
        [Id] uniqueidentifier NOT NULL,
        [CurriculumTemplateId] uniqueidentifier NOT NULL,
        [GroupId] uniqueidentifier NOT NULL,
        [VersionNumber] int NOT NULL,
        [Title] nvarchar(160) NOT NULL,
        [PublishedAtUtc] datetimeoffset NOT NULL,
        [AvailableAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_PublishedCurriculumVersions] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_PublishedCurriculumVersions_Number] CHECK ([VersionNumber] > 0),
        CONSTRAINT [FK_PublishedCurriculumVersions_CurriculumTemplates_CurriculumTemplateId] FOREIGN KEY ([CurriculumTemplateId]) REFERENCES [CurriculumTemplates] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_PublishedCurriculumVersions_StudyGroups_GroupId] FOREIGN KEY ([GroupId]) REFERENCES [StudyGroups] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [LessonSegments] (
        [Id] uniqueidentifier NOT NULL,
        [LessonVersionId] uniqueidentifier NOT NULL,
        [Position] int NOT NULL,
        [Text] nvarchar(1000) NOT NULL,
        [AudioStorageKey] nvarchar(200) NOT NULL,
        CONSTRAINT [PK_LessonSegments] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_LessonSegments_Position] CHECK ([Position] > 0),
        CONSTRAINT [FK_LessonSegments_LessonVersions_LessonVersionId] FOREIGN KEY ([LessonVersionId]) REFERENCES [LessonVersions] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [GroupCurriculumAssignments] (
        [GroupId] uniqueidentifier NOT NULL,
        [PublishedCurriculumVersionId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_GroupCurriculumAssignments] PRIMARY KEY ([GroupId]),
        CONSTRAINT [FK_GroupCurriculumAssignments_StudyGroups_GroupId] FOREIGN KEY ([GroupId]) REFERENCES [StudyGroups] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId] FOREIGN KEY ([PublishedCurriculumVersionId]) REFERENCES [PublishedCurriculumVersions] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [PublishedLessonSlots] (
        [Id] uniqueidentifier NOT NULL,
        [PublishedCurriculumVersionId] uniqueidentifier NOT NULL,
        [LessonVersionId] uniqueidentifier NOT NULL,
        [WeekNumber] int NOT NULL,
        [DayNumber] int NOT NULL,
        [SortOrder] int NOT NULL,
        [AvailableAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_PublishedLessonSlots] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_PublishedLessonSlots_Order] CHECK ([WeekNumber] > 0 AND [DayNumber] > 0 AND [SortOrder] > 0),
        CONSTRAINT [FK_PublishedLessonSlots_LessonVersions_LessonVersionId] FOREIGN KEY ([LessonVersionId]) REFERENCES [LessonVersions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_PublishedLessonSlots_PublishedCurriculumVersions_PublishedCurriculumVersionId] FOREIGN KEY ([PublishedCurriculumVersionId]) REFERENCES [PublishedCurriculumVersions] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE TABLE [StudentStageProgress] (
        [StudentId] uniqueidentifier NOT NULL,
        [PublishedCurriculumVersionId] uniqueidentifier NOT NULL,
        [SlotId] uniqueidentifier NOT NULL,
        [StageKey] nvarchar(32) NOT NULL,
        [CompletedSegments] int NOT NULL,
        [IsComplete] bit NOT NULL,
        [UpdatedAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_StudentStageProgress] PRIMARY KEY ([StudentId], [PublishedCurriculumVersionId], [SlotId], [StageKey]),
        CONSTRAINT [CK_StudentStageProgress_Count] CHECK ([CompletedSegments] >= 0),
        CONSTRAINT [FK_StudentStageProgress_AspNetUsers_StudentId] FOREIGN KEY ([StudentId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentStageProgress_PublishedCurriculumVersions_PublishedCurriculumVersionId] FOREIGN KEY ([PublishedCurriculumVersionId]) REFERENCES [PublishedCurriculumVersions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentStageProgress_PublishedLessonSlots_SlotId] FOREIGN KEY ([SlotId]) REFERENCES [PublishedLessonSlots] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE UNIQUE INDEX [IX_LessonVersions_LessonDefinitionId_VersionNumber] ON [LessonVersions] ([LessonDefinitionId], [VersionNumber]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE UNIQUE INDEX [IX_LessonSegments_LessonVersionId_Position] ON [LessonSegments] ([LessonVersionId], [Position]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE INDEX [IX_PublishedCurriculumVersions_CurriculumTemplateId] ON [PublishedCurriculumVersions] ([CurriculumTemplateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE UNIQUE INDEX [IX_PublishedCurriculumVersions_GroupId_CurriculumTemplateId_VersionNumber] ON [PublishedCurriculumVersions] ([GroupId], [CurriculumTemplateId], [VersionNumber]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE INDEX [IX_GroupCurriculumAssignments_PublishedCurriculumVersionId] ON [GroupCurriculumAssignments] ([PublishedCurriculumVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE INDEX [IX_PublishedLessonSlots_LessonVersionId] ON [PublishedLessonSlots] ([LessonVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE UNIQUE INDEX [IX_PublishedLessonSlots_PublishedCurriculumVersionId_WeekNumber_DayNumber_SortOrder] ON [PublishedLessonSlots] ([PublishedCurriculumVersionId], [WeekNumber], [DayNumber], [SortOrder]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE INDEX [IX_StudentStageProgress_PublishedCurriculumVersionId] ON [StudentStageProgress] ([PublishedCurriculumVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    CREATE INDEX [IX_StudentStageProgress_SlotId] ON [StudentStageProgress] ([SlotId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260928213000_AddStudentCore'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260928213000_AddStudentCore', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    ALTER TABLE [GroupCurriculumAssignments] DROP CONSTRAINT [FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    ALTER TABLE [StudentStageProgress] DROP CONSTRAINT [FK_StudentStageProgress_PublishedLessonSlots_SlotId];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    DROP INDEX [IX_StudentStageProgress_SlotId] ON [StudentStageProgress];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    ALTER TABLE [PublishedLessonSlots] ADD CONSTRAINT [AK_PublishedLessonSlots_Id_PublishedCurriculumVersionId] UNIQUE ([Id], [PublishedCurriculumVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    ALTER TABLE [PublishedCurriculumVersions] ADD CONSTRAINT [AK_PublishedCurriculumVersions_Id_GroupId] UNIQUE ([Id], [GroupId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    CREATE INDEX [IX_StudentStageProgress_SlotId_PublishedCurriculumVersionId] ON [StudentStageProgress] ([SlotId], [PublishedCurriculumVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    CREATE INDEX [IX_GroupCurriculumAssignments_PublishedCurriculumVersionId_GroupId] ON [GroupCurriculumAssignments] ([PublishedCurriculumVersionId], [GroupId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    ALTER TABLE [GroupCurriculumAssignments] ADD CONSTRAINT [FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId_GroupId] FOREIGN KEY ([PublishedCurriculumVersionId], [GroupId]) REFERENCES [PublishedCurriculumVersions] ([Id], [GroupId]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    ALTER TABLE [StudentStageProgress] ADD CONSTRAINT [FK_StudentStageProgress_PublishedLessonSlots_SlotId_PublishedCurriculumVersionId] FOREIGN KEY ([SlotId], [PublishedCurriculumVersionId]) REFERENCES [PublishedLessonSlots] ([Id], [PublishedCurriculumVersionId]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261001144800_EnforceCurriculumScope'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261001144800_EnforceCurriculumScope', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [StudyGroups] ADD [AssignedCurriculumTemplateId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [StudyGroups] ADD [CurriculumAssignmentRevision] uniqueidentifier NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [StudyGroups] ADD [LastCurriculumAssignmentRequestHash] nvarchar(64) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [StudyGroups] ADD [LastCurriculumAssignmentRequestId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [PublishedCurriculumVersions] ADD [PublishRequestHash] nvarchar(64) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [PublishedCurriculumVersions] ADD [SourceDraftRevision] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [CurriculumTemplates] ADD [CreateRequestHash] nvarchar(64) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [CurriculumTemplates] ADD [Description] nvarchar(1000) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [CurriculumTemplates] ADD [DraftRevision] uniqueidentifier NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [CurriculumTemplates] ADD [DraftUpdatedAtUtc] datetimeoffset NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [CurriculumTemplates] ADD [LastUpdateRequestHash] nvarchar(64) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [CurriculumTemplates] ADD [LastUpdateRequestId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    CREATE TABLE [CurriculumDraftLessonSlots] (
        [Id] uniqueidentifier NOT NULL,
        [CurriculumTemplateId] uniqueidentifier NOT NULL,
        [LessonVersionId] uniqueidentifier NOT NULL,
        [WeekNumber] int NOT NULL,
        [DayNumber] int NOT NULL,
        [SortOrder] int NOT NULL,
        CONSTRAINT [PK_CurriculumDraftLessonSlots] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_CurriculumDraftLessonSlots_Position] CHECK ([WeekNumber] BETWEEN 1 AND 52 AND [DayNumber] BETWEEN 1 AND 7 AND [SortOrder] BETWEEN 1 AND 100),
        CONSTRAINT [FK_CurriculumDraftLessonSlots_CurriculumTemplates_CurriculumTemplateId] FOREIGN KEY ([CurriculumTemplateId]) REFERENCES [CurriculumTemplates] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_CurriculumDraftLessonSlots_LessonVersions_LessonVersionId] FOREIGN KEY ([LessonVersionId]) REFERENCES [LessonVersions] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    CREATE INDEX [IX_StudyGroups_AssignedCurriculumTemplateId] ON [StudyGroups] ([AssignedCurriculumTemplateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    CREATE UNIQUE INDEX [IX_CurriculumDraftLessonSlots_CurriculumTemplateId_LessonVersionId] ON [CurriculumDraftLessonSlots] ([CurriculumTemplateId], [LessonVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    CREATE UNIQUE INDEX [IX_CurriculumDraftLessonSlots_CurriculumTemplateId_WeekNumber_DayNumber_SortOrder] ON [CurriculumDraftLessonSlots] ([CurriculumTemplateId], [WeekNumber], [DayNumber], [SortOrder]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    CREATE INDEX [IX_CurriculumDraftLessonSlots_LessonVersionId] ON [CurriculumDraftLessonSlots] ([LessonVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    ALTER TABLE [StudyGroups] ADD CONSTRAINT [FK_StudyGroups_CurriculumTemplates_AssignedCurriculumTemplateId] FOREIGN KEY ([AssignedCurriculumTemplateId]) REFERENCES [CurriculumTemplates] ([Id]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261002101732_AddIndependentCurriculumDraft'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261002101732_AddIndependentCurriculumDraft', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE TABLE [LessonAiContents] (
        [Id] uniqueidentifier NOT NULL,
        [LessonVersionId] uniqueidentifier NOT NULL,
        [CreatedByAdminId] uniqueidentifier NOT NULL,
        [Revision] uniqueidentifier NOT NULL,
        [Status] nvarchar(16) NOT NULL,
        [PayloadJson] nvarchar(max) NULL,
        [ProviderName] nvarchar(32) NULL,
        [ErrorCode] nvarchar(64) NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        [UpdatedAtUtc] datetimeoffset NOT NULL,
        [ApprovedAtUtc] datetimeoffset NULL,
        CONSTRAINT [PK_LessonAiContents] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_LessonAiContents_LessonVersions_LessonVersionId] FOREIGN KEY ([LessonVersionId]) REFERENCES [LessonVersions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_LessonAiContents_AspNetUsers_CreatedByAdminId] FOREIGN KEY ([CreatedByAdminId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE TABLE [StudentAiDailyUsages] (
        [StudentId] uniqueidentifier NOT NULL,
        [DayUtc] date NOT NULL,
        [UsedRequests] int NOT NULL,
        CONSTRAINT [PK_StudentAiDailyUsages] PRIMARY KEY ([StudentId], [DayUtc]),
        CONSTRAINT [CK_StudentAiDailyUsages_Used] CHECK ([UsedRequests] >= 0),
        CONSTRAINT [FK_StudentAiDailyUsages_AspNetUsers_StudentId] FOREIGN KEY ([StudentId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    ALTER TABLE [PublishedLessonSlots] ADD [AiContentId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE TABLE [StudentPracticeAttempts] (
        [Id] uniqueidentifier NOT NULL,
        [StudentId] uniqueidentifier NOT NULL,
        [PublishedCurriculumVersionId] uniqueidentifier NOT NULL,
        [SlotId] uniqueidentifier NOT NULL,
        [StageKey] nvarchar(32) NOT NULL,
        [Position] int NOT NULL,
        [Answer] nvarchar(600) NOT NULL,
        [FeedbackJson] nvarchar(3000) NOT NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_StudentPracticeAttempts] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_StudentPracticeAttempts_AspNetUsers_StudentId] FOREIGN KEY ([StudentId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentPracticeAttempts_PublishedCurriculumVersions_PublishedCurriculumVersionId] FOREIGN KEY ([PublishedCurriculumVersionId]) REFERENCES [PublishedCurriculumVersions] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_StudentPracticeAttempts_PublishedLessonSlots_SlotId_PublishedCurriculumVersionId] FOREIGN KEY ([SlotId], [PublishedCurriculumVersionId]) REFERENCES [PublishedLessonSlots] ([Id], [PublishedCurriculumVersionId]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE INDEX [IX_LessonAiContents_CreatedByAdminId] ON [LessonAiContents] ([CreatedByAdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE INDEX [IX_LessonAiContents_LessonVersionId_CreatedAtUtc] ON [LessonAiContents] ([LessonVersionId], [CreatedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE INDEX [IX_PublishedLessonSlots_AiContentId] ON [PublishedLessonSlots] ([AiContentId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE INDEX [IX_StudentPracticeAttempts_PublishedCurriculumVersionId] ON [StudentPracticeAttempts] ([PublishedCurriculumVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE INDEX [IX_StudentPracticeAttempts_SlotId_PublishedCurriculumVersionId] ON [StudentPracticeAttempts] ([SlotId], [PublishedCurriculumVersionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    CREATE INDEX [IX_StudentPracticeAttempts_StudentId_SlotId_StageKey_CreatedAtUtc] ON [StudentPracticeAttempts] ([StudentId], [SlotId], [StageKey], [CreatedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    ALTER TABLE [PublishedLessonSlots] ADD CONSTRAINT [FK_PublishedLessonSlots_LessonAiContents_AiContentId] FOREIGN KEY ([AiContentId]) REFERENCES [LessonAiContents] ([Id]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261004190000_AddAiLessonContent'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261004190000_AddAiLessonContent', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    CREATE TABLE [AiProviderConfigurations] (
        [Id] uniqueidentifier NOT NULL,
        [Capability] nvarchar(32) NOT NULL,
        [ProviderKey] nvarchar(48) NOT NULL,
        [EncryptedApiKey] nvarchar(max) NULL,
        [KeyLast4] nvarchar(4) NULL,
        [AccountId] nvarchar(160) NULL,
        [ProjectId] nvarchar(160) NULL,
        [Model] nvarchar(200) NULL,
        [Priority] int NOT NULL,
        [Enabled] bit NOT NULL,
        [Status] nvarchar(40) NOT NULL,
        [LastSuccessfulRequestUtc] datetimeoffset NULL,
        [LastFailedRequestUtc] datetimeoffset NULL,
        [LastFailureReason] nvarchar(64) NULL,
        [UpdatedByAdminId] uniqueidentifier NOT NULL,
        [UpdatedAtUtc] datetimeoffset NOT NULL,
        [Revision] uniqueidentifier NOT NULL,
        [LastMutationRequestId] uniqueidentifier NULL,
        [LastMutationRequestHash] nvarchar(64) NULL,
        CONSTRAINT [PK_AiProviderConfigurations] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_AiProviderConfigurations_Priority] CHECK ([Priority] BETWEEN 1 AND 100),
        CONSTRAINT [FK_AiProviderConfigurations_AspNetUsers_UpdatedByAdminId] FOREIGN KEY ([UpdatedByAdminId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    CREATE TABLE [AiProviderAuditEntries] (
        [Id] uniqueidentifier NOT NULL,
        [ProviderConfigurationId] uniqueidentifier NOT NULL,
        [Capability] nvarchar(32) NOT NULL,
        [ProviderKey] nvarchar(48) NOT NULL,
        [Action] nvarchar(40) NOT NULL,
        [ResultCode] nvarchar(64) NOT NULL,
        [ActorAdminId] uniqueidentifier NOT NULL,
        [OccurredAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_AiProviderAuditEntries] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AiProviderAuditEntries_AiProviderConfigurations_ProviderConfigurationId] FOREIGN KEY ([ProviderConfigurationId]) REFERENCES [AiProviderConfigurations] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_AiProviderAuditEntries_AspNetUsers_ActorAdminId] FOREIGN KEY ([ActorAdminId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    CREATE INDEX [IX_AiProviderConfigurations_Capability_Enabled_Priority] ON [AiProviderConfigurations] ([Capability], [Enabled], [Priority]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_AiProviderConfigurations_Capability_ProviderKey] ON [AiProviderConfigurations] ([Capability], [ProviderKey]) WHERE [Capability] IS NOT NULL AND [ProviderKey] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    CREATE INDEX [IX_AiProviderConfigurations_UpdatedByAdminId] ON [AiProviderConfigurations] ([UpdatedByAdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    CREATE INDEX [IX_AiProviderAuditEntries_ActorAdminId] ON [AiProviderAuditEntries] ([ActorAdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    CREATE INDEX [IX_AiProviderAuditEntries_ProviderConfigurationId_OccurredAtUtc] ON [AiProviderAuditEntries] ([ProviderConfigurationId], [OccurredAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261005134000_AddAiProviderManagement'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261005134000_AddAiProviderManagement', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261010210000_AddLessonArchive'
)
BEGIN
    ALTER TABLE [LessonDefinitions] ADD [IsArchived] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261010210000_AddLessonArchive'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261010210000_AddLessonArchive', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261010220000_AddLessonMediaDeletionOutbox'
)
BEGIN
    CREATE TABLE [PendingLessonMediaDeletions] (
        [StorageKey] nvarchar(200) NOT NULL,
        [QueuedAtUtc] datetimeoffset NOT NULL,
        [NextAttemptAtUtc] datetimeoffset NOT NULL,
        [Attempts] int NOT NULL,
        CONSTRAINT [PK_PendingLessonMediaDeletions] PRIMARY KEY ([StorageKey])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261010220000_AddLessonMediaDeletionOutbox'
)
BEGIN
    CREATE INDEX [IX_PendingLessonMediaDeletions_NextAttemptAtUtc] ON [PendingLessonMediaDeletions] ([NextAttemptAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261010220000_AddLessonMediaDeletionOutbox'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261010220000_AddLessonMediaDeletionOutbox', N'10.0.10');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261011090000_AddLessonWorkflows'
)
BEGIN
    CREATE TABLE [LessonWorkflows] (
        [LessonVersionId] uniqueidentifier NOT NULL,
        [Revision] uniqueidentifier NOT NULL,
        [StagesJson] nvarchar(max) NOT NULL,
        [UpdatedAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_LessonWorkflows] PRIMARY KEY ([LessonVersionId]),
        CONSTRAINT [FK_LessonWorkflows_LessonVersions_LessonVersionId] FOREIGN KEY ([LessonVersionId]) REFERENCES [LessonVersions] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261011090000_AddLessonWorkflows'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261011090000_AddLessonWorkflows', N'10.0.10');
END;

COMMIT;
GO
