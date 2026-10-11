using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShadowingEnglish.Infrastructure.Database;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261011090000_AddLessonWorkflows")]
public partial class AddLessonWorkflows : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "LessonWorkflows",
            columns: table => new
            {
                LessonVersionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Revision = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                StagesJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16000, nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_LessonWorkflows", x => x.LessonVersionId);
                table.ForeignKey(
                    name: "FK_LessonWorkflows_LessonVersions_LessonVersionId",
                    column: x => x.LessonVersionId,
                    principalTable: "LessonVersions",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "LessonWorkflows");
}
