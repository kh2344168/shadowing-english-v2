using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations
{
    public partial class AddStudentCore : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(name: "CurriculumTemplates", columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false)
            }, constraints: table => table.PrimaryKey("PK_CurriculumTemplates", x => x.Id));

            migrationBuilder.CreateTable(name: "LessonDefinitions", columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Title = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false)
            }, constraints: table => table.PrimaryKey("PK_LessonDefinitions", x => x.Id));

            migrationBuilder.CreateTable(name: "LessonVersions", columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                LessonDefinitionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                VersionNumber = table.Column<int>(type: "int", nullable: false),
                Title = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                Description = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            }, constraints: table =>
            {
                table.PrimaryKey("PK_LessonVersions", x => x.Id);
                table.CheckConstraint("CK_LessonVersions_Number", "[VersionNumber] > 0");
                table.ForeignKey("FK_LessonVersions_LessonDefinitions_LessonDefinitionId", x => x.LessonDefinitionId, "LessonDefinitions", "Id", onDelete: ReferentialAction.Restrict);
            });

            migrationBuilder.CreateTable(name: "PublishedCurriculumVersions", columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                CurriculumTemplateId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                VersionNumber = table.Column<int>(type: "int", nullable: false),
                Title = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                PublishedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                AvailableAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            }, constraints: table =>
            {
                table.PrimaryKey("PK_PublishedCurriculumVersions", x => x.Id);
                table.CheckConstraint("CK_PublishedCurriculumVersions_Number", "[VersionNumber] > 0");
                table.ForeignKey("FK_PublishedCurriculumVersions_CurriculumTemplates_CurriculumTemplateId", x => x.CurriculumTemplateId, "CurriculumTemplates", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_PublishedCurriculumVersions_StudyGroups_GroupId", x => x.GroupId, "StudyGroups", "Id", onDelete: ReferentialAction.Restrict);
            });

            migrationBuilder.CreateTable(name: "LessonSegments", columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                LessonVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Position = table.Column<int>(type: "int", nullable: false),
                Text = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                AudioStorageKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false)
            }, constraints: table =>
            {
                table.PrimaryKey("PK_LessonSegments", x => x.Id);
                table.CheckConstraint("CK_LessonSegments_Position", "[Position] > 0");
                table.ForeignKey("FK_LessonSegments_LessonVersions_LessonVersionId", x => x.LessonVersionId, "LessonVersions", "Id", onDelete: ReferentialAction.Restrict);
            });

            migrationBuilder.CreateTable(name: "GroupCurriculumAssignments", columns: table => new
            {
                GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                PublishedCurriculumVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
            }, constraints: table =>
            {
                table.PrimaryKey("PK_GroupCurriculumAssignments", x => x.GroupId);
                table.ForeignKey("FK_GroupCurriculumAssignments_StudyGroups_GroupId", x => x.GroupId, "StudyGroups", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_GroupCurriculumAssignments_PublishedCurriculumVersions_PublishedCurriculumVersionId", x => x.PublishedCurriculumVersionId, "PublishedCurriculumVersions", "Id", onDelete: ReferentialAction.Restrict);
            });

            migrationBuilder.CreateTable(name: "PublishedLessonSlots", columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                PublishedCurriculumVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                LessonVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                WeekNumber = table.Column<int>(type: "int", nullable: false),
                DayNumber = table.Column<int>(type: "int", nullable: false),
                SortOrder = table.Column<int>(type: "int", nullable: false),
                AvailableAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            }, constraints: table =>
            {
                table.PrimaryKey("PK_PublishedLessonSlots", x => x.Id);
                table.CheckConstraint("CK_PublishedLessonSlots_Order", "[WeekNumber] > 0 AND [DayNumber] > 0 AND [SortOrder] > 0");
                table.ForeignKey("FK_PublishedLessonSlots_LessonVersions_LessonVersionId", x => x.LessonVersionId, "LessonVersions", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_PublishedLessonSlots_PublishedCurriculumVersions_PublishedCurriculumVersionId", x => x.PublishedCurriculumVersionId, "PublishedCurriculumVersions", "Id", onDelete: ReferentialAction.Restrict);
            });

            migrationBuilder.CreateTable(name: "StudentStageProgress", columns: table => new
            {
                StudentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                PublishedCurriculumVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                SlotId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                StageKey = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                CompletedSegments = table.Column<int>(type: "int", nullable: false),
                IsComplete = table.Column<bool>(type: "bit", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            }, constraints: table =>
            {
                table.PrimaryKey("PK_StudentStageProgress", x => new { x.StudentId, x.PublishedCurriculumVersionId, x.SlotId, x.StageKey });
                table.CheckConstraint("CK_StudentStageProgress_Count", "[CompletedSegments] >= 0");
                table.ForeignKey("FK_StudentStageProgress_AspNetUsers_StudentId", x => x.StudentId, "AspNetUsers", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_StudentStageProgress_PublishedCurriculumVersions_PublishedCurriculumVersionId", x => x.PublishedCurriculumVersionId, "PublishedCurriculumVersions", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_StudentStageProgress_PublishedLessonSlots_SlotId", x => x.SlotId, "PublishedLessonSlots", "Id", onDelete: ReferentialAction.Restrict);
            });

            migrationBuilder.CreateIndex("IX_LessonVersions_LessonDefinitionId_VersionNumber", "LessonVersions", new[] { "LessonDefinitionId", "VersionNumber" }, unique: true);
            migrationBuilder.CreateIndex("IX_LessonSegments_LessonVersionId_Position", "LessonSegments", new[] { "LessonVersionId", "Position" }, unique: true);
            migrationBuilder.CreateIndex("IX_PublishedCurriculumVersions_CurriculumTemplateId", "PublishedCurriculumVersions", "CurriculumTemplateId");
            migrationBuilder.CreateIndex("IX_PublishedCurriculumVersions_GroupId_CurriculumTemplateId_VersionNumber", "PublishedCurriculumVersions", new[] { "GroupId", "CurriculumTemplateId", "VersionNumber" }, unique: true);
            migrationBuilder.CreateIndex("IX_GroupCurriculumAssignments_PublishedCurriculumVersionId", "GroupCurriculumAssignments", "PublishedCurriculumVersionId");
            migrationBuilder.CreateIndex("IX_PublishedLessonSlots_LessonVersionId", "PublishedLessonSlots", "LessonVersionId");
            migrationBuilder.CreateIndex("IX_PublishedLessonSlots_PublishedCurriculumVersionId_WeekNumber_DayNumber_SortOrder", "PublishedLessonSlots", new[] { "PublishedCurriculumVersionId", "WeekNumber", "DayNumber", "SortOrder" }, unique: true);
            migrationBuilder.CreateIndex("IX_StudentStageProgress_PublishedCurriculumVersionId", "StudentStageProgress", "PublishedCurriculumVersionId");
            migrationBuilder.CreateIndex("IX_StudentStageProgress_SlotId", "StudentStageProgress", "SlotId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable("GroupCurriculumAssignments");
            migrationBuilder.DropTable("LessonSegments");
            migrationBuilder.DropTable("StudentStageProgress");
            migrationBuilder.DropTable("PublishedLessonSlots");
            migrationBuilder.DropTable("LessonVersions");
            migrationBuilder.DropTable("PublishedCurriculumVersions");
            migrationBuilder.DropTable("LessonDefinitions");
            migrationBuilder.DropTable("CurriculumTemplates");
        }
    }
}
