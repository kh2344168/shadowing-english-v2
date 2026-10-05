using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261004190000_AddAiLessonContent")]
public sealed class AddAiLessonContent : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "LessonAiContents",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                LessonVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                CreatedByAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Revision = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                PayloadJson = table.Column<string>(type: "nvarchar(max)", maxLength: 32000, nullable: true),
                ProviderName = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                ErrorCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                ApprovedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_LessonAiContents", x => x.Id);
                table.ForeignKey("FK_LessonAiContents_LessonVersions_LessonVersionId", x => x.LessonVersionId,
                    "LessonVersions", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_LessonAiContents_AspNetUsers_CreatedByAdminId", x => x.CreatedByAdminId,
                    "AspNetUsers", "Id", onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "StudentAiDailyUsages",
            columns: table => new
            {
                StudentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                DayUtc = table.Column<DateOnly>(type: "date", nullable: false),
                UsedRequests = table.Column<int>(type: "int", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_StudentAiDailyUsages", x => new { x.StudentId, x.DayUtc });
                table.CheckConstraint("CK_StudentAiDailyUsages_Used", "[UsedRequests] >= 0");
                table.ForeignKey("FK_StudentAiDailyUsages_AspNetUsers_StudentId", x => x.StudentId,
                    "AspNetUsers", "Id", onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.AddColumn<Guid>(name: "AiContentId", table: "PublishedLessonSlots",
            type: "uniqueidentifier", nullable: true);

        migrationBuilder.CreateTable(
            name: "StudentPracticeAttempts",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                StudentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                PublishedCurriculumVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                SlotId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                StageKey = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                Position = table.Column<int>(type: "int", nullable: false),
                Answer = table.Column<string>(type: "nvarchar(600)", maxLength: 600, nullable: false),
                FeedbackJson = table.Column<string>(type: "nvarchar(3000)", maxLength: 3000, nullable: false),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_StudentPracticeAttempts", x => x.Id);
                table.ForeignKey("FK_StudentPracticeAttempts_AspNetUsers_StudentId", x => x.StudentId,
                    "AspNetUsers", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_StudentPracticeAttempts_PublishedCurriculumVersions_PublishedCurriculumVersionId",
                    x => x.PublishedCurriculumVersionId, "PublishedCurriculumVersions", "Id", onDelete: ReferentialAction.Restrict);
                table.ForeignKey("FK_StudentPracticeAttempts_PublishedLessonSlots_SlotId_PublishedCurriculumVersionId",
                    x => new { x.SlotId, x.PublishedCurriculumVersionId }, "PublishedLessonSlots",
                    new[] { "Id", "PublishedCurriculumVersionId" }, onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex("IX_LessonAiContents_CreatedByAdminId", "LessonAiContents", "CreatedByAdminId");
        migrationBuilder.CreateIndex("IX_LessonAiContents_LessonVersionId_CreatedAtUtc", "LessonAiContents",
            new[] { "LessonVersionId", "CreatedAtUtc" });
        migrationBuilder.CreateIndex("IX_PublishedLessonSlots_AiContentId", "PublishedLessonSlots", "AiContentId");
        migrationBuilder.CreateIndex("IX_StudentPracticeAttempts_PublishedCurriculumVersionId", "StudentPracticeAttempts", "PublishedCurriculumVersionId");
        migrationBuilder.CreateIndex("IX_StudentPracticeAttempts_SlotId_PublishedCurriculumVersionId", "StudentPracticeAttempts",
            new[] { "SlotId", "PublishedCurriculumVersionId" });
        migrationBuilder.CreateIndex("IX_StudentPracticeAttempts_StudentId_SlotId_StageKey_CreatedAtUtc", "StudentPracticeAttempts",
            new[] { "StudentId", "SlotId", "StageKey", "CreatedAtUtc" });
        migrationBuilder.AddForeignKey(
            name: "FK_PublishedLessonSlots_LessonAiContents_AiContentId",
            table: "PublishedLessonSlots",
            column: "AiContentId",
            principalTable: "LessonAiContents",
            principalColumn: "Id",
            onDelete: ReferentialAction.Restrict);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("StudentPracticeAttempts");
        migrationBuilder.DropTable("StudentAiDailyUsages");
        migrationBuilder.DropForeignKey("FK_PublishedLessonSlots_LessonAiContents_AiContentId", "PublishedLessonSlots");
        migrationBuilder.DropIndex("IX_PublishedLessonSlots_AiContentId", "PublishedLessonSlots");
        migrationBuilder.DropColumn("AiContentId", "PublishedLessonSlots");
        migrationBuilder.DropTable("LessonAiContents");
    }
}
